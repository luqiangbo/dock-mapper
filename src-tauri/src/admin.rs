use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use windows::{
    core::{HRESULT, PCWSTR},
    Win32::{
        Foundation::{CloseHandle, ERROR_CANCELLED, WAIT_OBJECT_0},
        Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
        System::Threading::{
            GetCurrentProcess, GetExitCodeProcess, OpenProcessToken, WaitForSingleObject, INFINITE,
        },
        UI::{
            Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW},
            WindowsAndMessaging::SW_HIDE,
        },
    },
};

const APP_IDENTIFIER: &str = "com.luqiangbo.dockmapper";
const REQUEST_DIRECTORY: &str = "admin-requests";
const REQUEST_PREFIX: &str = "admin-";
static REQUEST_GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum AdminAction {
    Apply { confirm_takeover: bool },
    Restore,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdminRequest {
    id: String,
    action: AdminAction,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdminResponse {
    status: Option<crate::ScancodeMapStatus>,
    error: Option<String>,
}

pub fn helper_exit_code_from_args<I>(args: I) -> Option<i32>
where
    I: IntoIterator<Item = String>,
{
    let mut args = args.into_iter();
    let _program = args.next()?;
    if args.next().as_deref() != Some("--admin-helper") {
        return None;
    }
    let Some(id) = args.next() else {
        return Some(2);
    };
    if args.next().is_some() || !is_valid_request_id(&id) {
        return Some(2);
    }
    Some(run_helper(&id).unwrap_or(1))
}

pub fn invoke_helper(action: AdminAction) -> Result<crate::ScancodeMapStatus, String> {
    let root = application_data_dir()?;
    invoke_helper_at(&root, action, launch_elevated_helper)
}

fn invoke_helper_at<F>(
    app_data_dir: &Path,
    action: AdminAction,
    launch: F,
) -> Result<crate::ScancodeMapStatus, String>
where
    F: FnOnce(&str) -> Result<u32, String>,
{
    let request_dir = app_data_dir.join(REQUEST_DIRECTORY);
    fs::create_dir_all(&request_dir)
        .map_err(|error| format!("创建管理员请求目录失败：{error}"))?;
    let id = next_request_id();
    let request_path = request_path(&request_dir, &id)?;
    let response_path = response_path(&request_dir, &id)?;
    write_new_json(
        &request_path,
        &AdminRequest {
            id: id.clone(),
            action,
        },
    )?;

    let result = (|| {
        let exit_code = launch(&id)?;
        let response = read_json::<AdminResponse>(&response_path)
            .map_err(|error| format!("读取管理员助手结果失败：{error}"))?;
        if let Some(error) = response.error {
            return Err(error);
        }
        if exit_code != 0 {
            return Err(format!("管理员助手异常退出，代码：{exit_code}"));
        }
        response
            .status
            .ok_or_else(|| "管理员助手未返回系统映射状态".to_string())
    })();
    let _ = fs::remove_file(request_path);
    let _ = fs::remove_file(response_path);
    result
}

fn run_helper(id: &str) -> Result<i32, String> {
    if !is_elevated() {
        return Err("管理员助手没有获得管理员权限".into());
    }
    let app_data_dir = application_data_dir()?;
    let request_dir = app_data_dir.join(REQUEST_DIRECTORY);
    let request_path = request_path(&request_dir, id)?;
    let response_path = response_path(&request_dir, id)?;
    let request = read_json::<AdminRequest>(&request_path)?;
    if request.id != id {
        return Err("管理员请求 ID 不一致".into());
    }
    let _ = fs::remove_file(&request_path);
    let response = match execute_action(&app_data_dir.join("config.json"), request.action) {
        Ok(status) => AdminResponse {
            status: Some(status),
            error: None,
        },
        Err(error) => AdminResponse {
            status: None,
            error: Some(error),
        },
    };
    write_new_json(&response_path, &response)?;
    Ok(if response.error.is_some() { 1 } else { 0 })
}

fn execute_action(
    config_path: &Path,
    action: AdminAction,
) -> Result<crate::ScancodeMapStatus, String> {
    let config = crate::config::load_for_mutation(config_path)?;
    let current = crate::scancode_mapper::read()?;
    match action {
        AdminAction::Apply { confirm_takeover } => {
            let desired = crate::scancode_mapper::encode(&config.key_mappings)?;
            let status =
                crate::key_mapping::scancode_map_status(&config, current.as_deref())?;
            if status.state == crate::ScancodeMapState::SystemChanged && !confirm_takeover {
                return Err("系统已存在其他工具写入的 Scancode Map；请确认备份后接管".into());
            }
            let mut next_config = config;
            if next_config.scancode_map_backup.is_none()
                || status.state == crate::ScancodeMapState::SystemChanged
            {
                next_config.scancode_map_backup = Some(
                    crate::scancode_mapper::backup_encode(current.as_deref()).unwrap_or_default(),
                );
            }
            next_config.applied_scancode_map =
                crate::scancode_mapper::backup_encode(Some(&desired));
            crate::commit_scancode_change_at_path(
                config_path,
                current.as_deref(),
                Some(&desired),
                &next_config,
            )?;
            crate::key_mapping::scancode_map_status(&next_config, Some(&desired))
        }
        AdminAction::Restore => {
            let backup = crate::key_mapping::required_scancode_backup(
                config.scancode_map_backup.as_deref(),
            )?;
            let mut next_config = config;
            next_config.applied_scancode_map = None;
            crate::commit_scancode_change_at_path(
                config_path,
                current.as_deref(),
                backup.as_deref(),
                &next_config,
            )?;
            crate::key_mapping::scancode_map_status(&next_config, backup.as_deref())
        }
    }
}

fn application_data_dir() -> Result<PathBuf, String> {
    directories::BaseDirs::new()
        .map(|directories| directories.data_dir().join(APP_IDENTIFIER))
        .ok_or_else(|| "无法定位 DockMapper 应用数据目录".to_string())
}

fn next_request_id() -> String {
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!(
        "{REQUEST_PREFIX}{}-{created_at}-{}",
        std::process::id(),
        REQUEST_GENERATION.fetch_add(1, Ordering::Relaxed) + 1
    )
}

fn is_valid_request_id(id: &str) -> bool {
    id.strip_prefix(REQUEST_PREFIX).is_some_and(|suffix| {
        !suffix.is_empty()
            && suffix
                .chars()
                .all(|character| character.is_ascii_digit() || character == '-')
    })
}

fn request_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !is_valid_request_id(id) {
        return Err("管理员请求 ID 无效".into());
    }
    Ok(root.join(format!("{id}.request.json")))
}

fn response_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !is_valid_request_id(id) {
        return Err("管理员请求 ID 无效".into());
    }
    Ok(root.join(format!("{id}.response.json")))
}

fn write_new_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("创建管理员请求文件失败：{error}"))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("写入管理员请求文件失败：{error}"))
}

fn read_json<T>(path: &Path) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
{
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

fn launch_elevated_helper(id: &str) -> Result<u32, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("无法获取 DockMapper 程序路径：{error}"))?;
    let executable = wide(executable.as_os_str());
    let verb = wide(std::ffi::OsStr::new("runas"));
    let parameters = wide(std::ffi::OsStr::new(&format!("--admin-helper {id}")));
    let mut execute = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: PCWSTR(verb.as_ptr()),
        lpFile: PCWSTR(executable.as_ptr()),
        lpParameters: PCWSTR(parameters.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    unsafe {
        if let Err(error) = ShellExecuteExW(&mut execute) {
            if error.code() == HRESULT::from_win32(ERROR_CANCELLED.0) {
                return Err("用户取消了管理员授权".into());
            }
            return Err(format!("启动管理员助手失败：{error}"));
        }
        if execute.hProcess.is_invalid() {
            return Err("管理员助手没有返回进程句柄".into());
        }
        let wait = WaitForSingleObject(execute.hProcess, INFINITE);
        if wait != WAIT_OBJECT_0 {
            let _ = CloseHandle(execute.hProcess);
            return Err("等待管理员助手完成失败".into());
        }
        let mut exit_code = 1;
        let exit_result = GetExitCodeProcess(execute.hProcess, &mut exit_code);
        let _ = CloseHandle(execute.hProcess);
        exit_result.map_err(|error| format!("读取管理员助手退出状态失败：{error}"))?;
        Ok(exit_code)
    }
}

fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
    value.encode_wide().chain(Some(0)).collect()
}

pub fn is_elevated() -> bool {
    unsafe {
        let process = GetCurrentProcess();
        let mut token_handle = Default::default();
        if OpenProcessToken(process, TOKEN_QUERY, &mut token_handle).is_err() {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut return_len = 0;
        let result = GetTokenInformation(
            token_handle,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut _),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut return_len,
        );
        let _ = CloseHandle(token_handle);
        result.is_ok() && elevation.TokenIsElevated != 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "dock-mapper-admin-{name}-{}-{}",
            std::process::id(),
            REQUEST_GENERATION.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn helper_argument_dispatch_is_strict() {
        assert_eq!(
            helper_exit_code_from_args(["dockmapper".into(), "--other".into()]),
            None
        );
        assert_eq!(
            helper_exit_code_from_args(["dockmapper".into(), "--admin-helper".into()]),
            Some(2)
        );
        assert_eq!(
            helper_exit_code_from_args([
                "dockmapper".into(),
                "--admin-helper".into(),
                "../request".into(),
            ]),
            Some(2)
        );
    }

    #[test]
    fn request_ids_cannot_escape_the_admin_directory() {
        let root = temporary_root("path");
        assert!(request_path(&root, "../config").is_err());
        let id = next_request_id();
        assert_eq!(request_path(&root, &id).unwrap().parent(), Some(root.as_path()));
    }

    #[test]
    fn launcher_failure_removes_request_files() {
        let root = temporary_root("cleanup");
        let result = invoke_helper_at(&root, AdminAction::Restore, |_| {
            Err("用户取消了管理员授权".into())
        });
        assert!(result.is_err());
        assert!(fs::read_dir(root.join(REQUEST_DIRECTORY))
            .unwrap()
            .next()
            .is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn successful_helper_result_is_read_and_cleaned_up() {
        let root = temporary_root("success");
        let root_for_helper = root.clone();
        let status = invoke_helper_at(&root, AdminAction::Restore, move |id| {
            let request_dir = root_for_helper.join(REQUEST_DIRECTORY);
            write_new_json(
                &response_path(&request_dir, id)?,
                &AdminResponse {
                    status: Some(crate::ScancodeMapStatus {
                        state: crate::ScancodeMapState::NotApplied,
                        backup_available: true,
                    }),
                    error: None,
                },
            )?;
            Ok(0)
        })
        .unwrap();
        assert_eq!(status.state, crate::ScancodeMapState::NotApplied);
        assert!(status.backup_available);
        assert!(fs::read_dir(root.join(REQUEST_DIRECTORY))
            .unwrap()
            .next()
            .is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn request_json_rejects_unknown_actions_and_fields() {
        let unknown_action = serde_json::json!({
            "id": next_request_id(),
            "action": { "type": "deleteEverything" }
        });
        assert!(serde_json::from_value::<AdminRequest>(unknown_action).is_err());

        let unknown_field = serde_json::json!({
            "id": next_request_id(),
            "action": { "type": "restore" },
            "path": "C:\\Windows\\System32"
        });
        assert!(serde_json::from_value::<AdminRequest>(unknown_field).is_err());
    }
}
