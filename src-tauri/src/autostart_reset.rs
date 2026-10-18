//! Make the plugin's delete operation idempotent without parsing localized errors.
use tauri_plugin_autostart::ManagerExt;
use windows::{
    core::{w, PCWSTR},
    Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS, WIN32_ERROR},
        System::Registry::{
            RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE,
        },
    },
};

fn absent_from_status(status: WIN32_ERROR) -> Result<bool, String> {
    if status == ERROR_FILE_NOT_FOUND || status == ERROR_PATH_NOT_FOUND {
        return Ok(true);
    }
    status.ok().map_err(|error| error.to_string())?;
    Ok(false)
}

fn registration_absent(app_name: &str) -> Result<bool, String> {
    let mut key = HKEY::default();
    let opened = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            w!("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run"),
            None,
            KEY_QUERY_VALUE,
            &mut key,
        )
    };
    if opened != ERROR_SUCCESS {
        return absent_from_status(opened);
    }
    let name = app_name
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut size = 0;
    let result = unsafe {
        RegQueryValueExW(
            key,
            PCWSTR(name.as_ptr()),
            None,
            None,
            None,
            Some(&mut size),
        )
    };
    unsafe {
        let _ = RegCloseKey(key);
    }
    absent_from_status(result)
}

fn ensure_disabled_with(
    disable: impl FnOnce() -> Result<(), String>,
    absent: impl FnOnce() -> Result<bool, String>,
) -> Result<(), String> {
    match disable() {
        Ok(()) => Ok(()),
        Err(error) => match absent() {
            Ok(true) => Ok(()),
            Ok(false) => Err(format!("重置开机启动失败：{error}")),
            Err(probe) => Err(format!(
                "重置开机启动失败：{error}；确认启动项是否已移除失败：{probe}"
            )),
        },
    }
}

pub fn ensure_disabled(app: &tauri::AppHandle) -> Result<(), String> {
    ensure_disabled_with(
        || {
            app.autolaunch()
                .disable()
                .map_err(|error| error.to_string())
        },
        // The plugin uses package_info().name when no custom name is configured.
        || registration_absent(&app.package_info().name),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Foundation::ERROR_ACCESS_DENIED;

    #[test]
    fn first_launch_and_repeated_reset_succeed_when_no_startup_entry_exists() {
        for _ in 0..2 {
            assert!(ensure_disabled_with(|| Err("os error 2".into()), || Ok(true)).is_ok());
        }
    }
    #[test]
    fn successful_delete_does_not_require_another_registry_read() {
        assert!(ensure_disabled_with(|| Ok(()), || panic!("删除成功无需再次查询")).is_ok());
    }
    #[test]
    fn failed_delete_cannot_be_ignored_while_entry_exists_or_cannot_be_checked() {
        assert!(
            ensure_disabled_with(|| Err("拒绝访问".into()), || Ok(false))
                .unwrap_err()
                .contains("拒绝访问")
        );
        let error =
            ensure_disabled_with(|| Err("删除失败".into()), || Err("读取失败".into())).unwrap_err();
        assert!(error.contains("删除失败") && error.contains("读取失败"));
    }
    #[test]
    fn only_missing_registry_key_or_value_means_already_disabled() {
        assert_eq!(absent_from_status(ERROR_FILE_NOT_FOUND).unwrap(), true);
        assert_eq!(absent_from_status(ERROR_PATH_NOT_FOUND).unwrap(), true);
        assert_eq!(absent_from_status(ERROR_SUCCESS).unwrap(), false);
        assert!(absent_from_status(ERROR_ACCESS_DENIED).is_err());
    }
}
