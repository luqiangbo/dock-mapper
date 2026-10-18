use crate::{
    admin, config,
    key_mapping_runtime::{self, Rules, Runtime},
    legacy_key_mapping::{self, Preview},
    scancode_mapper, AppState, KeyMapping, SupportedKey,
};
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, State};

// Private administrator-helper response; no public system-write API.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScancodeMapState {
    NotApplied,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScancodeMapStatus {
    pub state: ScancodeMapState,
    pub backup_available: bool,
}
#[derive(Clone, Serialize)]
pub struct MappingStatus {
    pub state: &'static str,
    pub enabled: bool,
    pub rule_count: usize,
    pub error: Option<String>,
    pub legacy: Option<Preview>,
}
#[tauri::command]
pub fn get_supported_keys() -> Vec<SupportedKey> {
    crate::supported_keys()
        .into_iter()
        .filter(|key| scancode_mapper::scan_code(key.code).is_some())
        .collect()
}
#[tauri::command]
pub fn get_key_mappings(state: State<'_, AppState>) -> Result<Vec<KeyMapping>, String> {
    Ok(state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏")?
        .key_mappings
        .clone())
}
fn effective(config: &config::AppConfig, legacy: &Preview) -> Result<Rules, String> {
    let rules = key_mapping_runtime::rules(&config.key_mappings)?;
    if config.key_mapping_runtime_version < 1 {
        return Err("旧映射尚未完成备份迁移，请重试初始化".into());
    }
    if !config.key_mapping_enabled || legacy.present || legacy.waiting_restart {
        Ok(Rules::new())
    } else {
        Ok(rules)
    }
}
pub fn notify(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(config) = state.config.lock() {
            crate::tray::sync_mapping_toggle(app, config.key_mapping_enabled);
        }
    }
    if let Err(error) = app.emit("key-mapping-changed", ()) {
        tracing::warn!(%error, "Mapping status notification failed");
    }
}
#[tauri::command]
pub fn get_key_mapping_status(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<MappingStatus, String> {
    let _mutation = state.mutation_lock.lock().map_err(|_| "配置写入锁已损坏")?;
    let config = state.config.lock().map_err(|_| "配置状态已损坏")?.clone();
    let runtime = app.state::<Runtime>();
    let preview = legacy_key_mapping::preview(&state.config_path);
    let (legacy, mut error) = match preview {
        Ok(value) => (Some(value), None),
        Err(error) => (None, Some(error)),
    };
    if legacy
        .as_ref()
        .is_none_or(|value| value.present || value.waiting_restart)
        && runtime.count() > 0
    {
        if let Err(stop_error) = runtime.configure(&app, Rules::new()) {
            error = Some(stop_error);
        }
    }
    let runtime_error = runtime.error();
    let mode = if error.is_some() {
        "error"
    } else if legacy.as_ref().is_some_and(|value| value.present) {
        "legacy_blocked"
    } else if legacy.as_ref().is_some_and(|value| value.waiting_restart) {
        "restart_required"
    } else if runtime_error.is_some() {
        error = runtime_error;
        "error"
    } else if !config.key_mapping_enabled {
        "paused"
    } else if config.key_mappings.iter().all(|rule| !rule.enabled) {
        "no_rules"
    } else if runtime.count() == 0 {
        error = Some("规则已保存，但尚未启动映射，请重试运行".into());
        "error"
    } else {
        "running"
    };
    Ok(MappingStatus {
        state: mode,
        enabled: config.key_mapping_enabled,
        rule_count: config
            .key_mappings
            .iter()
            .filter(|rule| rule.enabled)
            .count(),
        error,
        legacy,
    })
}
#[tauri::command]
pub fn get_legacy_key_mappings(state: State<'_, AppState>) -> Result<Preview, String> {
    legacy_key_mapping::preview(&state.config_path)
}

// Publish configuration only after native reconfiguration and persistence succeed.
fn commit_with(
    next: Rules,
    previous: Rules,
    mut apply: impl FnMut(Rules) -> Result<(), String>,
    save: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    if let Err(error) = apply(next) {
        return match apply(previous) {
            Ok(()) => Err(error),
            Err(rollback) => Err(format!("{error}；恢复原运行规则失败：{rollback}")),
        };
    }
    if let Err(error) = save() {
        return match apply(previous) {
            Ok(()) => Err(error),
            Err(rollback) => Err(format!("{error}；恢复原运行规则失败：{rollback}")),
        };
    }
    Ok(())
}
fn change(
    app: &AppHandle,
    state: &AppState,
    edit: impl FnOnce(&mut config::AppConfig),
) -> Result<(), String> {
    let _mutation = state.mutation_lock.lock().map_err(|_| "配置写入锁已损坏")?;
    if state.admin_operation_in_progress.load(Ordering::Acquire) {
        return Err("遗留映射清理进行中，请稍候".into());
    }
    let previous = state.config.lock().map_err(|_| "配置状态已损坏")?.clone();
    let mut next = previous.clone();
    edit(&mut next);
    let runtime = app.state::<Runtime>();
    let legacy = match legacy_key_mapping::preview(&state.config_path) {
        Ok(legacy) => legacy,
        Err(error) => {
            let stopped = runtime.configure(app, Rules::new());
            let error = match stopped {
                Ok(()) => error,
                Err(stop) => format!("{error}；暂停映射失败：{stop}"),
            };
            runtime.report(error.clone());
            return Err(error);
        }
    };
    commit_with(
        effective(&next, &legacy)?,
        effective(&previous, &legacy)?,
        |rules| runtime.configure(app, rules),
        || config::save(&state.config_path, &next),
    )?;
    *state.config.lock().map_err(|_| "配置状态已损坏")? = next;
    drop(_mutation);
    notify(app);
    if let Err(error) = app.emit("config-changed", ()) {
        tracing::warn!(%error, "Configuration notification failed");
    }
    Ok(())
}
#[tauri::command]
pub fn sync_key_mappings(
    app: AppHandle,
    state: State<'_, AppState>,
    mappings: Vec<KeyMapping>,
) -> Result<(), String> {
    key_mapping_runtime::rules(&mappings)?;
    change(&app, &state, |config| config.key_mappings = mappings)
}
#[tauri::command]
pub fn set_key_mapping_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    if !crate::defaults_bootstrap::application_ready(app.state()) {
        return Err("请等待应用设置初始化完成".into());
    }
    change(&app, &state, |config| config.key_mapping_enabled = enabled)
}
pub fn toggle_from_tray(app: &AppHandle, state: &AppState) -> Result<(), String> {
    if !crate::defaults_bootstrap::application_ready(app.state()) {
        return Err("请等待应用设置初始化完成".into());
    }
    change(app, state, |config| {
        config.key_mapping_enabled = !config.key_mapping_enabled
    })
}
pub fn initialize(app: &AppHandle) {
    let state = app.state::<AppState>();
    let result = (|| {
        let _mutation = state.mutation_lock.lock().map_err(|_| "配置写入锁已损坏")?;
        let mut config = state.config.lock().map_err(|_| "配置状态已损坏")?;
        legacy_key_mapping::migrate(&state.config_path, &mut config)?;
        let legacy = legacy_key_mapping::preview(&state.config_path)?;
        app.state::<Runtime>()
            .configure(app, effective(&config, &legacy)?)
    })();
    if let Err(error) = result {
        tracing::error!(%error,"Runtime mapping initialization failed");
        app.state::<Runtime>().report(error);
    }
    notify(app);
}
#[tauri::command]
pub async fn clear_legacy_key_mappings(
    app: AppHandle,
    expected_value: Option<String>,
) -> Result<(), String> {
    {
        let state = app.state::<AppState>();
        let _mutation = state.mutation_lock.lock().map_err(|_| "配置写入锁已损坏")?;
        if state.admin_operation_in_progress.load(Ordering::Acquire) {
            return Err("已有管理员操作正在进行".into());
        }
        let expected = scancode_mapper::backup_decode(expected_value.as_deref())?;
        legacy_key_mapping::prepare_clear(&state.config_path, expected.as_deref())?;
        if state
            .admin_operation_in_progress
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err("已有管理员操作正在进行".into());
        }
        if let Err(error) = app.state::<Runtime>().configure(&app, Rules::new()) {
            state
                .admin_operation_in_progress
                .store(false, Ordering::Release);
            return Err(error);
        }
    }
    let result = tokio::task::spawn_blocking(move || {
        admin::invoke_helper(admin::AdminAction::ClearLegacy { expected_value })
    })
    .await
    .map_err(|error| format!("管理员助手后台任务失败：{error}"))
    .and_then(|result| result);
    {
        let state = app.state::<AppState>();
        let _mutation = state.mutation_lock.lock().map_err(|_| "配置写入锁已损坏")?;
        state
            .admin_operation_in_progress
            .store(false, Ordering::Release);
        match config::load_for_mutation(&state.config_path) {
            Ok(config) => *state.config.lock().map_err(|_| "配置状态已损坏")? = config,
            Err(error) => {
                app.state::<Runtime>().report(error.clone());
                notify(&app);
                return Err(format!("清理后重新读取配置失败：{error}"));
            }
        }
    }
    initialize(&app);
    result.map(|_| ())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selectable_keys_include_both_alt_sides_without_enabling_legacy_altgr() {
        let keys = get_supported_keys();
        assert!(keys
            .iter()
            .any(|key| key.code == crate::KeyCode::Alt && key.label == "左 Alt"));
        assert!(keys
            .iter()
            .any(|key| key.code == crate::KeyCode::AltRight && key.label == "右 Alt"));
        assert!(!keys.iter().any(|key| key.code == crate::KeyCode::AltGr));
    }
    #[test]
    fn failed_save_restores_the_previous_runtime_and_does_not_publish_new_rules() {
        let mut applied = Vec::new();
        assert!(commit_with(
            [(1, 2)].into(),
            [(1, 3)].into(),
            |rules| {
                applied.push(rules);
                Ok(())
            },
            || Err("磁盘已满".into())
        )
        .is_err());
        assert_eq!(applied, vec![Rules::from([(1, 2)]), Rules::from([(1, 3)])]);
    }
    #[test]
    fn failed_hook_install_does_not_save_and_reports_rollback_failure() {
        let error = commit_with(
            [(1, 2)].into(),
            Rules::new(),
            |_| Err("hook".into()),
            || panic!("failed rules saved"),
        )
        .unwrap_err();
        assert!(error.contains("恢复原运行规则失败"));
    }
    #[test]
    fn legacy_and_restart_gates_keep_saved_rules_inactive() {
        let mut config = config::AppConfig::default();
        config.key_mappings.push(KeyMapping {
            id: "a".into(),
            source_key: crate::KeyCode::KeyA,
            target_key: crate::KeyCode::KeyB,
            enabled: true,
        });
        let mut legacy = Preview {
            present: true,
            value: None,
            rules: vec![],
            parse_error: None,
            waiting_restart: false,
        };
        assert!(effective(&config, &legacy).unwrap().is_empty());
        legacy.present = false;
        legacy.waiting_restart = true;
        assert!(effective(&config, &legacy).unwrap().is_empty());
        legacy.waiting_restart = false;
        assert_eq!(effective(&config, &legacy).unwrap().len(), 1);
    }
}
