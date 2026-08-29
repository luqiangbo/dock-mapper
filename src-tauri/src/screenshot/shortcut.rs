use super::{
    handle_start_capture, open_screenshot_history, pin_recent_screenshot, toggle_latest_pin,
    AppState,
};
use crate::config::ScreenshotConfig;
use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(super) enum ShortcutAction {
    Capture,
    PinRecent,
    OpenHistory,
    ToggleLatestPin,
}

impl ShortcutAction {
    const ALL: [Self; 4] = [
        Self::Capture,
        Self::PinRecent,
        Self::OpenHistory,
        Self::ToggleLatestPin,
    ];

    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Capture => "区域截图",
            Self::PinRecent => "最近截图贴图",
            Self::OpenHistory => "打开截图历史",
            Self::ToggleLatestPin => "显隐最近贴图",
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::Capture => "capture",
            Self::PinRecent => "pin_recent",
            Self::OpenHistory => "open_history",
            Self::ToggleLatestPin => "toggle_latest_pin",
        }
    }
}

#[derive(Clone, Default)]
pub(super) struct ShortcutRegistryState {
    registered: HashMap<ShortcutAction, String>,
    errors: HashMap<ShortcutAction, String>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutRuntimeStatus {
    action_id: &'static str,
    action: &'static str,
    shortcut: String,
    registered: bool,
    error: Option<String>,
}

fn tauri_shortcut(value: &str) -> String {
    value
        .replace("CommandOrControl", "CmdOrCtrl")
        .replace("Command", "Cmd")
}

fn normalized_shortcut(value: &str) -> String {
    let mut parts = tauri_shortcut(value)
        .split('+')
        .map(|part| match part.trim().to_ascii_lowercase().as_str() {
            "ctrl" | "control" => "control".to_string(),
            "cmd" | "command" => "command".to_string(),
            other => other.to_string(),
        })
        .collect::<Vec<_>>();
    parts.sort_unstable();
    parts.join("+")
}

pub(super) fn bindings(config: &ScreenshotConfig) -> Vec<(ShortcutAction, String)> {
    vec![
        (ShortcutAction::Capture, config.shortcut.clone()),
        (ShortcutAction::PinRecent, config.pin_shortcut.clone()),
        (ShortcutAction::OpenHistory, config.history_shortcut.clone()),
        (
            ShortcutAction::ToggleLatestPin,
            config.toggle_pin_shortcut.clone(),
        ),
    ]
}

pub(super) fn validate_bindings(config: &ScreenshotConfig) -> Result<(), String> {
    let mut values = HashSet::new();
    for (action, value) in bindings(config) {
        if !values.insert(normalized_shortcut(&value)) {
            return Err(format!("{}快捷键与其他截图快捷键重复", action.label()));
        }
    }
    Ok(())
}

fn dispatch(app: &AppHandle, action: ShortcutAction) {
    match action {
        ShortcutAction::Capture => handle_start_capture(app),
        ShortcutAction::PinRecent => pin_recent_screenshot(app),
        ShortcutAction::OpenHistory => open_screenshot_history(app),
        ShortcutAction::ToggleLatestPin => toggle_latest_pin(app),
    }
}

fn register_action(app: &AppHandle, action: ShortcutAction, shortcut: &str) -> Result<(), String> {
    let native_shortcut = tauri_shortcut(shortcut);
    if let Err(error) = app.global_shortcut()
        .on_shortcut(native_shortcut.as_str(), move |app, _, event| {
            if event.state() == ShortcutState::Pressed {
                dispatch(app, action);
            }
        })
    {
        let detail = error.to_string();
        tracing::warn!(target: "dock_mapper::shortcut", action = action.label(), shortcut, %detail, "注册全局快捷键失败");
        app.state::<AppState>()
            .shortcut_registry
            .lock()
            .map_err(|_| "快捷键状态已损坏".to_string())?
            .errors
            .insert(action, "已被其他应用占用或不受系统支持".into());
        return Err(detail);
    }
    let state = app.state::<AppState>();
    let mut registry = state
        .shortcut_registry
        .lock()
        .map_err(|_| "快捷键状态已损坏".to_string())?;
    registry.registered.insert(action, shortcut.into());
    registry.errors.remove(&action);
    Ok(())
}

fn unregister_action(app: &AppHandle, action: ShortcutAction) -> Result<(), String> {
    let current = app
        .state::<AppState>()
        .shortcut_registry
        .lock()
        .map_err(|_| "快捷键状态已损坏".to_string())?
        .registered
        .get(&action)
        .cloned();
    let Some(current) = current else {
        return Ok(());
    };
    app.global_shortcut()
        .unregister(tauri_shortcut(&current).as_str())
        .map_err(|error| error.to_string())?;
    app.state::<AppState>()
        .shortcut_registry
        .lock()
        .map_err(|_| "快捷键状态已损坏".to_string())?
        .registered
        .remove(&action);
    Ok(())
}

fn restore_actions(
    app: &AppHandle,
    actions: &[ShortcutAction],
    snapshot: &ShortcutRegistryState,
) -> Result<(), String> {
    for action in actions {
        let _ = unregister_action(app, *action);
    }
    let mut errors = Vec::new();
    for action in actions {
        if let Some(shortcut) = snapshot.registered.get(action) {
            if let Err(error) = register_action(app, *action, shortcut) {
                errors.push(format!("{}={error}", action.label()));
            }
        }
    }
    if errors.is_empty() {
        let state = app.state::<AppState>();
        let mut registry = state
            .shortcut_registry
            .lock()
            .map_err(|_| "快捷键状态已损坏".to_string())?;
        for action in actions {
            match snapshot.errors.get(action) {
                Some(error) => {
                    registry.errors.insert(*action, error.clone());
                }
                None => {
                    registry.errors.remove(action);
                }
            }
        }
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

pub(super) fn replace_changed(
    app: &AppHandle,
    previous: &ScreenshotConfig,
    next: &ScreenshotConfig,
) -> Result<(), String> {
    validate_bindings(next)?;
    let previous_bindings = bindings(previous).into_iter().collect::<HashMap<_, _>>();
    let next_bindings = bindings(next).into_iter().collect::<HashMap<_, _>>();
    let changed = ShortcutAction::ALL
        .into_iter()
        .filter(|action| previous_bindings.get(action) != next_bindings.get(action))
        .collect::<Vec<_>>();
    if changed.is_empty() {
        return Ok(());
    }
    let snapshot = app
        .state::<AppState>()
        .shortcut_registry
        .lock()
        .map_err(|_| "快捷键状态已损坏".to_string())?
        .clone();
    for action in &changed {
        if let Err(error) = unregister_action(app, *action) {
            let rollback = restore_actions(app, &changed, &snapshot).err();
            return Err(match rollback {
                Some(rollback) => format!("{error}；同时恢复旧快捷键失败：{rollback}"),
                None => error,
            });
        }
    }
    for action in &changed {
        let shortcut = next_bindings
            .get(action)
            .expect("all actions have bindings");
        if let Err(error) = register_action(app, *action, shortcut) {
            let rollback = restore_actions(app, &changed, &snapshot).err();
            return Err(match rollback {
                Some(rollback) => format!("{error}；同时恢复旧快捷键失败：{rollback}"),
                None => error,
            });
        }
    }
    Ok(())
}

pub(super) fn replace_all(app: &AppHandle, next: &ScreenshotConfig) -> Result<(), String> {
    validate_bindings(next)?;
    let snapshot = app
        .state::<AppState>()
        .shortcut_registry
        .lock()
        .map_err(|_| "快捷键状态已损坏".to_string())?
        .clone();
    let actions = ShortcutAction::ALL;
    for action in actions {
        if let Err(error) = unregister_action(app, action) {
            let rollback = restore_actions(app, &actions, &snapshot).err();
            return Err(match rollback {
                Some(rollback) => format!("{error}；同时恢复旧快捷键失败：{rollback}"),
                None => error,
            });
        }
    }
    let next_bindings = bindings(next).into_iter().collect::<HashMap<_, _>>();
    for action in actions {
        let shortcut = next_bindings
            .get(&action)
            .expect("all actions have bindings");
        if let Err(error) = register_action(app, action, shortcut) {
            let rollback = restore_actions(app, &actions, &snapshot).err();
            return Err(match rollback {
                Some(rollback) => format!("{error}；同时恢复旧快捷键失败：{rollback}"),
                None => error,
            });
        }
    }
    Ok(())
}

pub(super) fn statuses(
    app: &AppHandle,
    config: &ScreenshotConfig,
) -> Result<Vec<ShortcutRuntimeStatus>, String> {
    let state = app.state::<AppState>();
    let registry = state
        .shortcut_registry
        .lock()
        .map_err(|_| "快捷键状态已损坏".to_string())?;
    Ok(statuses_from_registry(config, &registry))
}

fn statuses_from_registry(
    config: &ScreenshotConfig,
    registry: &ShortcutRegistryState,
) -> Vec<ShortcutRuntimeStatus> {
    bindings(config)
        .into_iter()
        .map(|(action, shortcut)| ShortcutRuntimeStatus {
            action_id: action.id(),
            action: action.label(),
            registered: registry
                .registered
                .get(&action)
                .is_some_and(|value| value == &shortcut),
            error: registry.errors.get(&action).cloned(),
            shortcut,
        })
        .collect()
}

pub(super) fn register_initial(app: &AppHandle, config: &ScreenshotConfig) {
    if let Err(error) = validate_bindings(config) {
        tracing::error!(target: "dock_mapper::shortcut", %error, "截图快捷键配置无效");
        return;
    }
    for (action, shortcut) in bindings(config) {
        if let Err(error) = register_action(app, action, &shortcut) {
            tracing::error!(
                target: "dock_mapper::shortcut",
                action = action.label(),
                %shortcut,
                %error,
                "注册全局快捷键失败"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_duplicate_bindings_after_normalization() {
        let config = ScreenshotConfig {
            pin_shortcut: "Ctrl+1".into(),
            ..ScreenshotConfig::default()
        };
        assert!(validate_bindings(&config).is_err());
    }

    #[test]
    fn defaults_cover_four_distinct_actions() {
        let config = ScreenshotConfig::default();
        validate_bindings(&config).unwrap();
        assert_eq!(bindings(&config).len(), 4);
    }

    #[test]
    fn runtime_status_keeps_each_action_error_separate() {
        let config = ScreenshotConfig::default();
        let mut registry = ShortcutRegistryState::default();
        registry
            .registered
            .insert(ShortcutAction::Capture, config.shortcut.clone());
        registry
            .errors
            .insert(ShortcutAction::PinRecent, "已被其他应用占用".into());
        let statuses = statuses_from_registry(&config, &registry);
        let capture = statuses
            .iter()
            .find(|status| status.action_id == "capture")
            .unwrap();
        let pin = statuses
            .iter()
            .find(|status| status.action_id == "pin_recent")
            .unwrap();
        assert!(capture.registered);
        assert_eq!(capture.error, None);
        assert!(!pin.registered);
        assert_eq!(pin.error.as_deref(), Some("已被其他应用占用"));
    }
}
