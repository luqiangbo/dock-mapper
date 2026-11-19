//! User-initiated settings changes, independent of builds and installations.
use crate::{config, AppState};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_autostart::ManagerExt;

fn reset_config(previous: &config::AppConfig) -> Result<config::AppConfig, String> {
    let mut next = config::AppConfig::default();
    next.settings_reset_revision = previous
        .settings_reset_revision
        .checked_add(1)
        .filter(|revision| *revision <= 9_007_199_254_740_991)
        .ok_or("重置代次超出范围")?;
    next.installation_id = previous.installation_id.clone();
    next.defaults_build_id = previous.defaults_build_id.clone();
    next.scancode_map_backup = previous.scancode_map_backup.clone();
    next.applied_scancode_map = previous.applied_scancode_map.clone();
    Ok(next)
}

fn reset_with(
    state: &AppState,
    disable_autostart: impl FnOnce() -> Result<(), String>,
    restore_autostart: impl FnOnce() -> Result<(), String>,
) -> Result<u64, String> {
    let _mutation = state.lock_mutation()?;
    if state.admin_operation_in_progress.load(Ordering::Acquire) {
        return Err("系统映射操作进行中，请等待完成后再恢复设置".into());
    }
    let mut current = state.config.lock().map_err(|_| "配置状态已损坏")?;
    let next = reset_config(&current)?;
    disable_autostart()?;
    if let Err(error) = config::save_reset(&state.config_path, &next, &current) {
        return match restore_autostart() {
            Ok(()) => Err(error),
            Err(rollback) => Err(format!("{error}；恢复开机启动失败：{rollback}")),
        };
    }
    let revision = next.settings_reset_revision;
    *current = next;
    state.reset_pending.store(true, Ordering::Release);
    Ok(revision)
}

#[tauri::command]
pub fn reset_app_settings(app: AppHandle, state: State<'_, AppState>) -> Result<u64, String> {
    let enabled = std::cell::Cell::new(false);
    let revision = reset_with(
        &state,
        || {
            enabled.set(
                app.autolaunch()
                    .is_enabled()
                    .map_err(|error| format!("读取开机启动失败：{error}"))?,
            );
            crate::autostart_reset::ensure_disabled(&app)
        },
        || {
            if enabled.get() {
                app.autolaunch().enable().map_err(|error| error.to_string())
            } else {
                Ok(())
            }
        },
    )?;
    if let Err(error) = app.emit("app-settings-reset", revision) {
        tracing::warn!(%error, "设置已恢复，通知其他窗口失败");
    }
    Ok(revision)
}

fn set_autostart_with(
    state: &AppState,
    enabled: bool,
    change: impl FnOnce(bool) -> Result<(), String>,
) -> Result<(), String> {
    let _mutation = state.lock_mutation()?;
    change(enabled)
}

#[tauri::command]
pub fn set_app_autostart(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    set_autostart_with(&state, enabled, |enabled| {
        if enabled {
            app.autolaunch().enable().map_err(|error| error.to_string())
        } else {
            crate::autostart_reset::ensure_disabled(&app)
        }
    })
}

#[tauri::command]
pub fn get_ui_font(state: State<'_, AppState>) -> Result<String, String> {
    state
        .config
        .lock()
        .map(|config| config.ui_font.clone())
        .map_err(|_| "配置状态已损坏".into())
}

fn validate_font(font: &str) -> Result<String, String> {
    let font = font.trim();
    if font.chars().count() > 128
        || font
            .chars()
            .any(|c| c.is_control() || matches!(c, '"' | '\'' | '\\' | ';' | '{' | '}'))
    {
        return Err("字体名称无效".into());
    }
    Ok(font.to_owned())
}

#[tauri::command]
pub fn set_ui_font(
    app: AppHandle,
    state: State<'_, AppState>,
    font: String,
) -> Result<String, String> {
    let fonts = if font.trim().is_empty() {
        Vec::new()
    } else {
        system_fonts()?
    };
    save_ui_font(&state, &font, &fonts)?;
    // Serialize publication too: a newer save may have completed between the two locks.
    let _mutation = state.lock_mutation()?;
    let font = state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏")?
        .ui_font
        .clone();
    // A saved setting remains authoritative even if event delivery fails.
    app.emit("ui-font-changed", &font)
        .map_err(|error| format!("字体已保存，但窗口同步失败，请重试：{error}"))?;
    Ok(font)
}

fn save_ui_font(state: &AppState, font: &str, installed: &[String]) -> Result<String, String> {
    let font = validate_font(&font)?;
    if !font.is_empty() && !installed.iter().any(|name| name == &font) {
        return Err("该字体未安装，请刷新字体列表后重试".into());
    }
    let _mutation = state.lock_mutation()?;
    let mut current = state.config.lock().map_err(|_| "配置状态已损坏")?;
    let mut next = current.clone();
    next.ui_font = font.clone();
    config::save(&state.config_path, &next)?;
    *current = next;
    Ok(font)
}

fn system_fonts() -> Result<Vec<String>, String> {
    use windows::Win32::Graphics::DirectWrite::{
        DWriteCreateFactory, IDWriteFactory, DWRITE_FACTORY_TYPE_SHARED,
    };
    unsafe {
        let factory: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)
            .map_err(|error| format!("读取系统字体失败：{error}"))?;
        let mut collection = None;
        factory
            .GetSystemFontCollection(&mut collection, true)
            .map_err(|error| error.to_string())?;
        let collection = collection.ok_or("系统字体集合为空")?;
        let mut fonts = Vec::new();
        for index in 0..collection.GetFontFamilyCount() {
            let family = collection
                .GetFontFamily(index)
                .map_err(|error| error.to_string())?;
            let names = family.GetFamilyNames().map_err(|error| error.to_string())?;
            let mut selected = 0;
            for locale in [windows::core::w!("zh-cn"), windows::core::w!("en-us")] {
                let mut index = 0;
                let mut exists = windows::core::BOOL::default();
                names
                    .FindLocaleName(locale, &mut index, &mut exists)
                    .map_err(|error| error.to_string())?;
                if exists.as_bool() {
                    selected = index;
                    break;
                }
            }
            let length = names
                .GetStringLength(selected)
                .map_err(|error| error.to_string())?;
            let mut name = vec![0u16; length as usize + 1];
            names
                .GetString(selected, &mut name)
                .map_err(|error| error.to_string())?;
            if let Ok(font) = validate_font(&String::from_utf16_lossy(&name[..length as usize])) {
                if !font.is_empty() {
                    fonts.push(font);
                }
            }
        }
        fonts.sort_by_key(|font| font.to_lowercase());
        fonts.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
        Ok(fonts)
    }
}

#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(system_fonts)
        .await
        .map_err(|error| format!("字体枚举任务失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn fixture() -> (std::path::PathBuf, AppState) {
        let root = crate::test_support::temporary_directory("dockmapper-settings");
        let path = root.join("config.json");
        let mut config = config::AppConfig::default();
        config.minimize_to_tray = false;
        config.ui_font = "Arial".into();
        config.scancode_map_backup = Some("registry-backup".into());
        config.applied_scancode_map = Some("system-map".into());
        config.translation_config.baidu_key = Some("private".into());
        config::save(&path, &config).unwrap();
        let history = Arc::new(crate::history::HistoryStore::deferred(root.join("history")));
        (root, AppState::new(config, path, history))
    }

    #[test]
    fn reset_persists_defaults_and_recovery_but_preserves_other_files_and_blocks_stale_writes() {
        let (root, state) = fixture();
        std::fs::write(root.join("history-sentinel"), b"keep").unwrap();
        assert_eq!(reset_with(&state, || Ok(()), || Ok(())).unwrap(), 1);
        let restored = config::load(&state.config_path);
        assert!(restored.minimize_to_tray);
        assert!(restored.ui_font.is_empty());
        assert!(restored.translation_config.baidu_key.is_none());
        assert_eq!(
            restored.scancode_map_backup.as_deref(),
            Some("registry-backup")
        );
        assert_eq!(restored.applied_scancode_map.as_deref(), Some("system-map"));
        assert_eq!(
            std::fs::read(root.join("history-sentinel")).unwrap(),
            b"keep"
        );
        assert!(state.lock_mutation().is_err());
        assert!(set_autostart_with(&state, true, |_| panic!("旧请求不能重新开启自启")).is_err());
        assert!(reset_with(&state, || panic!("不重复操作"), || Ok(())).is_err());
        std::fs::write(&state.config_path, "corrupt").unwrap();
        let backup = config::load(&state.config_path);
        assert_eq!(backup.settings_reset_revision, 1);
        assert!(backup.ui_font.is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reset_failure_keeps_settings_and_restores_autostart_then_allows_retry() {
        let (root, state) = fixture();
        state
            .admin_operation_in_progress
            .store(true, Ordering::Release);
        assert!(reset_with(&state, || panic!("管理员操作期间不能重置"), || Ok(())).is_err());
        state
            .admin_operation_in_progress
            .store(false, Ordering::Release);
        let backup = state.config_path.with_extension("json.bak");
        std::fs::create_dir(&backup).unwrap();
        let restored = std::cell::Cell::new(false);
        assert!(reset_with(
            &state,
            || Ok(()),
            || {
                restored.set(true);
                Ok(())
            }
        )
        .is_err());
        assert!(restored.get());
        assert_eq!(config::load(&state.config_path).ui_font, "Arial");
        assert!(state.lock_mutation().is_ok());
        std::fs::remove_dir(&backup).unwrap();
        assert!(reset_with(
            &state,
            || Err("启动项拒绝访问".into()),
            || panic!("未修改无需回滚")
        )
        .is_err());
        assert!(reset_with(&state, || Ok(()), || Ok(())).is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_font_names_cannot_inject_styles() {
        assert_eq!(validate_font(" 微软雅黑 ").unwrap(), "微软雅黑");
        for name in ["Arial\"; color:red", "font\nother", "font\\name"] {
            assert!(validate_font(name).is_err());
        }
    }

    #[test]
    fn font_selection_survives_reopen_and_failed_changes_keep_the_saved_selection() {
        let (root, state) = fixture();
        let fonts = vec!["Arial".into(), "微软雅黑".into()];
        save_ui_font(&state, "微软雅黑", &fonts).unwrap();
        assert_eq!(config::load(&state.config_path).ui_font, "微软雅黑");
        assert!(save_ui_font(&state, "Missing Font", &fonts).is_err());
        assert_eq!(state.config.lock().unwrap().ui_font, "微软雅黑");
        let backup = state.config_path.with_extension("json.bak");
        std::fs::remove_file(&backup).unwrap();
        std::fs::create_dir(&backup).unwrap();
        assert!(save_ui_font(&state, "Arial", &fonts).is_err());
        assert_eq!(config::load(&state.config_path).ui_font, "微软雅黑");
        assert_eq!(state.config.lock().unwrap().ui_font, "微软雅黑");
        std::fs::remove_dir(&backup).unwrap();
        save_ui_font(&state, "", &fonts).unwrap();
        assert!(config::load(&state.config_path).ui_font.is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn installed_fonts_are_nonempty_and_usable_as_css_family_names() {
        let fonts = system_fonts().unwrap();
        assert!(!fonts.is_empty());
        assert!(fonts.iter().all(|font| validate_font(font).is_ok()));
    }
}
