use crate::{persist, sys_monitor, taskbar, AppState};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

pub const DEFAULT_WIDTH: f64 = 180.0;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryScheme {
    #[default]
    Capsule,
    Ring,
    Gauge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WidgetConfig {
    pub memory_scheme: MemoryScheme,
    pub refresh_interval_secs: u8,
    pub network_interface: Option<String>,
}

impl Default for WidgetConfig {
    fn default() -> Self {
        Self {
            memory_scheme: MemoryScheme::Capsule,
            refresh_interval_secs: 1,
            network_interface: None,
        }
    }
}

#[tauri::command]
pub fn refresh_widget_position(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let width = *state
        .widget_width
        .lock()
        .map_err(|_| "挂件宽度状态已损坏".to_string())?;
    taskbar::refresh_widget_position(&app, width);
    Ok(())
}

#[tauri::command]
pub fn get_widget_config(state: State<'_, AppState>) -> Result<WidgetConfig, String> {
    state
        .config
        .lock()
        .map(|config| config.widget_config.clone())
        .map_err(|_| "配置状态已损坏".to_string())
}

#[tauri::command]
pub fn get_network_interfaces() -> Vec<String> {
    let networks = sysinfo::Networks::new_with_refreshed_list();
    let mut names = networks
        .iter()
        .map(|(name, _)| name.to_string())
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    names
}

#[tauri::command]
pub fn update_widget_config(
    app: AppHandle,
    state: State<'_, AppState>,
    mut config: WidgetConfig,
) -> Result<WidgetConfig, String> {
    let _mutation = state
        .mutation_lock
        .lock()
        .map_err(|_| "配置写入锁已损坏".to_string())?;
    config.refresh_interval_secs = config.refresh_interval_secs.clamp(1, 5);
    let previous_config = {
        let mut current = state
            .config
            .lock()
            .map_err(|_| "配置状态已损坏".to_string())?;
        let previous = current.clone();
        current.widget_config = config.clone();
        previous
    };
    if let Err(error) = persist(&state) {
        *state
            .config
            .lock()
            .map_err(|_| "配置状态已损坏".to_string())? = previous_config;
        return Err(error);
    }
    if let Some(control) = app.try_state::<sys_monitor::SysMonitorControl>() {
        control.set_interval(config.refresh_interval_secs);
        control.set_network_interface(config.network_interface.clone());
    }
    let width = state
        .widget_width
        .lock()
        .map(|value| *value)
        .unwrap_or(DEFAULT_WIDTH);
    taskbar::refresh_widget_position(&app, width);
    app.emit("widget-config-changed", &config)
        .map_err(|error| error.to_string())?;
    Ok(config)
}

#[tauri::command]
pub fn sync_widget_dynamic_width(
    app: AppHandle,
    state: State<'_, AppState>,
    width: f64,
) -> Result<(), String> {
    let width = taskbar::sync_dynamic_width(&app, width);
    *state
        .widget_width
        .lock()
        .map_err(|_| "挂件宽度状态已损坏".to_string())? = width;
    Ok(())
}

pub fn setup_window(app: &tauri::App) -> Result<(), String> {
    let widget = app
        .get_webview_window("taskbar_widget")
        .ok_or_else(|| "缺少 taskbar_widget 窗口".to_string())?;
    #[cfg(target_os = "windows")]
    taskbar::embed_widget_to_taskbar(&widget);
    let widget_app = app.handle().clone();
    widget.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::ScaleFactorChanged { .. } | tauri::WindowEvent::Focused(true)
        ) {
            let width = widget_app
                .state::<AppState>()
                .widget_width
                .lock()
                .map(|value| *value)
                .unwrap_or(DEFAULT_WIDTH);
            taskbar::refresh_widget_position(&widget_app, width);
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_scheme_only_accepts_current_string_values() {
        assert_eq!(
            serde_json::from_str::<MemoryScheme>(r#""capsule""#).unwrap(),
            MemoryScheme::Capsule
        );
        assert!(serde_json::from_str::<MemoryScheme>("1").is_err());
    }
}
