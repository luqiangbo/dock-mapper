use crate::{admin, config, persist, scancode_mapper, AppState, KeyMapping, SupportedKey};
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, State};

#[tauri::command]
pub fn get_supported_keys() -> Vec<SupportedKey> {
    crate::supported_keys()
}

#[tauri::command]
pub fn get_key_mappings(state: State<'_, AppState>) -> Result<Vec<KeyMapping>, String> {
    state
        .config
        .lock()
        .map(|config| config.key_mappings.clone())
        .map_err(|_| "配置状态已损坏".to_string())
}

#[tauri::command]
pub fn sync_key_mappings(
    app: AppHandle,
    state: State<'_, AppState>,
    mappings: Vec<KeyMapping>,
) -> Result<(), String> {
    let _mutation = state
        .mutation_lock
        .lock()
        .map_err(|_| "配置写入锁已损坏".to_string())?;
    if state.admin_operation_in_progress.load(Ordering::Acquire) {
        return Err("管理员操作进行中，请完成后再修改映射规则".into());
    }
    scancode_mapper::encode(&mappings)?;
    let previous_config = {
        let mut config = state
            .config
            .lock()
            .map_err(|_| "配置状态已损坏".to_string())?;
        let previous = config.clone();
        config.key_mappings = mappings;
        previous
    };
    if let Err(error) = persist(&state) {
        *state
            .config
            .lock()
            .map_err(|_| "配置状态已损坏".to_string())? = previous_config;
        return Err(error);
    }
    app.emit("config-changed", ())
        .map_err(|error| error.to_string())?;
    let _ = app.emit("scancode-map-changed", ());
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScancodeMapState {
    NotApplied,
    Applied,
    DraftChanged,
    SystemChanged,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScancodeMapStatus {
    pub state: ScancodeMapState,
    pub backup_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ApplyScancodeMapOutcome {
    Applied,
    ConfirmationRequired,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApplyScancodeMapResult {
    pub outcome: ApplyScancodeMapOutcome,
    pub status: ScancodeMapStatus,
}

fn classify_scancode_map(
    current: Option<&[u8]>,
    desired: &[u8],
    applied: Option<&[u8]>,
) -> ScancodeMapState {
    match applied {
        None if current.is_none() => ScancodeMapState::NotApplied,
        None => ScancodeMapState::SystemChanged,
        Some(applied) if current != Some(applied) => ScancodeMapState::SystemChanged,
        Some(applied) if desired != applied => ScancodeMapState::DraftChanged,
        Some(_) => ScancodeMapState::Applied,
    }
}

pub(crate) fn scancode_map_status(
    config: &config::AppConfig,
    current: Option<&[u8]>,
) -> Result<ScancodeMapStatus, String> {
    let desired = scancode_mapper::encode(&config.key_mappings)?;
    let applied = scancode_mapper::backup_decode(config.applied_scancode_map.as_deref())?;
    Ok(ScancodeMapStatus {
        state: classify_scancode_map(current, &desired, applied.as_deref()),
        backup_available: config.scancode_map_backup.is_some(),
    })
}

pub(crate) fn required_scancode_backup(value: Option<&str>) -> Result<Option<Vec<u8>>, String> {
    value
        .ok_or_else(|| "没有可恢复的应用前映射".to_string())
        .and_then(|backup| scancode_mapper::backup_decode(Some(backup)))
}

#[tauri::command]
pub fn get_scancode_map_status(
    state: State<'_, AppState>,
) -> Result<ScancodeMapStatus, String> {
    let config = state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())?
        .clone();
    let current = scancode_mapper::read()?;
    scancode_map_status(&config, current.as_deref())
}

async fn run_admin_action(
    app: &AppHandle,
    action: admin::AdminAction,
) -> Result<ScancodeMapStatus, String> {
    let state = app.state::<AppState>();
    let mutation = state
        .mutation_lock
        .lock()
        .map_err(|_| "配置写入锁已损坏".to_string())?;
    if state
        .admin_operation_in_progress
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("已有管理员操作正在进行，请稍候".into());
    }
    drop(mutation);

    let result = tokio::task::spawn_blocking(move || admin::invoke_helper(action))
        .await
        .map_err(|error| format!("管理员助手后台任务失败：{error}"))
        .and_then(|result| result);
    app.state::<AppState>()
        .admin_operation_in_progress
        .store(false, Ordering::Release);
    let status = result?;

    let state = app.state::<AppState>();
    let reloaded = config::load_for_mutation(&state.config_path)?;
    *state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())? = reloaded;
    let _ = app.emit("config-changed", ());
    let _ = app.emit("scancode-map-changed", ());
    Ok(status)
}

#[tauri::command]
pub async fn apply_scancode_map(
    app: AppHandle,
    confirm_takeover: bool,
) -> Result<ApplyScancodeMapResult, String> {
    let span = tracing::info_span!(target: "dock_mapper::scancode", "apply_scancode_map");
    let _entered = span.enter();
    let state = app.state::<AppState>();
    let config = state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())?
        .clone();
    let current = scancode_mapper::read()?;
    let status = scancode_map_status(&config, current.as_deref())?;
    if status.state == ScancodeMapState::SystemChanged && !confirm_takeover {
        return Ok(ApplyScancodeMapResult {
            outcome: ApplyScancodeMapOutcome::ConfirmationRequired,
            status,
        });
    }
    drop(state);
    let status = run_admin_action(&app, admin::AdminAction::Apply { confirm_takeover }).await?;
    Ok(ApplyScancodeMapResult {
        outcome: ApplyScancodeMapOutcome::Applied,
        status,
    })
}

#[tauri::command]
pub async fn restore_scancode_map(app: AppHandle) -> Result<ScancodeMapStatus, String> {
    let span = tracing::info_span!(target: "dock_mapper::scancode", "restore_scancode_map");
    let _entered = span.enter();
    run_admin_action(&app, admin::AdminAction::Restore).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restore_requires_a_backup() {
        assert_eq!(
            required_scancode_backup(None).unwrap_err(),
            "没有可恢复的应用前映射"
        );
    }

    #[test]
    fn status_distinguishes_all_registry_states() {
        assert_eq!(
            classify_scancode_map(None, &[3, 4], None),
            ScancodeMapState::NotApplied
        );
        assert_eq!(
            classify_scancode_map(Some(&[3, 4]), &[3, 4], Some(&[3, 4])),
            ScancodeMapState::Applied
        );
        assert_eq!(
            classify_scancode_map(Some(&[3, 4]), &[5, 6], Some(&[3, 4])),
            ScancodeMapState::DraftChanged
        );
        assert_eq!(
            classify_scancode_map(Some(&[7, 8]), &[5, 6], Some(&[3, 4])),
            ScancodeMapState::SystemChanged
        );
        assert_eq!(
            classify_scancode_map(Some(&[7, 8]), &[7, 8], None),
            ScancodeMapState::SystemChanged
        );
    }
}
