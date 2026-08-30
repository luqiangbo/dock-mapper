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

pub type UsageScheme = MemoryScheme;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WidgetMetricKind {
    #[default]
    Network,
    Cpu,
    Memory,
    Battery,
    /// Kept only so configurations written by 1.1.0 preview builds can be
    /// loaded and normalized without making the complete config unreadable.
    #[doc(hidden)]
    #[serde(rename = "disk_io")]
    DiskIoLegacy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WidgetMetricConfig {
    pub kind: WidgetMetricKind,
    pub enabled: bool,
    pub usage_scheme: UsageScheme,
}

impl Default for WidgetMetricConfig {
    fn default() -> Self {
        Self { kind: WidgetMetricKind::Network, enabled: true, usage_scheme: UsageScheme::Capsule }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WidgetConfig {
    /// Kept for lossless reads of 1.0.5 configuration and API clients.
    pub memory_scheme: MemoryScheme,
    pub metrics: Vec<WidgetMetricConfig>,
    pub refresh_interval_secs: u8,
    pub network_interface: Option<String>,
}

impl Default for WidgetConfig {
    fn default() -> Self {
        Self {
            memory_scheme: MemoryScheme::Capsule,
            metrics: vec![
                WidgetMetricConfig::default(),
                WidgetMetricConfig { kind: WidgetMetricKind::Memory, enabled: true, usage_scheme: MemoryScheme::Capsule },
            ],
            refresh_interval_secs: 1,
            network_interface: None,
        }
    }
}

impl WidgetConfig {
    pub fn normalize(&mut self) {
        let mut normalized = Vec::new();
        for metric in std::mem::take(&mut self.metrics) {
            if metric.kind == WidgetMetricKind::DiskIoLegacy {
                continue;
            }
            if !normalized.iter().any(|item: &WidgetMetricConfig| item.kind == metric.kind) {
                normalized.push(metric);
            }
        }
        let had_metric_config = !normalized.is_empty();
        if normalized.is_empty() {
            normalized = Self::default().metrics;
        }
        for kind in [
            WidgetMetricKind::Network,
            WidgetMetricKind::Cpu,
            WidgetMetricKind::Memory,
            WidgetMetricKind::Battery,
        ] {
            if !normalized.iter().any(|item| item.kind == kind) {
                normalized.push(WidgetMetricConfig {
                    kind,
                    enabled: false,
                    usage_scheme: self.memory_scheme,
                });
            }
        }
        // A taskbar widget with every switch disabled still owns taskbar
        // space but cannot communicate anything useful. Keep the network
        // metric as a deterministic recovery default.
        if !normalized.iter().any(|item| item.enabled) {
            if let Some(network) = normalized
                .iter_mut()
                .find(|item| item.kind == WidgetMetricKind::Network)
            {
                network.enabled = true;
            }
        }
        if let Some(memory) = normalized.iter_mut().find(|item| item.kind == WidgetMetricKind::Memory) {
            if had_metric_config {
                // Per-metric styles are authoritative for current configs;
                // retain the old field as a compatibility mirror.
                self.memory_scheme = memory.usage_scheme;
            } else {
                // A 1.0.5 config has no metric list, so migrate its legacy
                // memory presentation into the new per-metric setting.
                memory.usage_scheme = self.memory_scheme;
            }
        }
        self.metrics = normalized;
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
    config.normalize();
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

    #[test]
    fn normalize_migrates_missing_metrics_to_network_and_memory() {
        let mut config = WidgetConfig { metrics: Vec::new(), memory_scheme: MemoryScheme::Ring, ..WidgetConfig::default() };
        config.normalize();
        assert_eq!(config.metrics.len(), 4);
        assert_eq!(config.metrics[1].kind, WidgetMetricKind::Memory);
        assert_eq!(config.metrics[1].usage_scheme, MemoryScheme::Ring);
    }

    #[test]
    fn normalize_keeps_at_least_one_metric_enabled() {
        let mut config = WidgetConfig {
            metrics: vec![
                WidgetMetricConfig { kind: WidgetMetricKind::Network, enabled: false, usage_scheme: MemoryScheme::Capsule },
                WidgetMetricConfig { kind: WidgetMetricKind::Memory, enabled: false, usage_scheme: MemoryScheme::Ring },
            ],
            ..WidgetConfig::default()
        };
        config.normalize();
        assert!(config
            .metrics
            .iter()
            .any(|metric| metric.kind == WidgetMetricKind::Network && metric.enabled));
    }

    #[test]
    fn normalize_preserves_a_current_memory_metric_style() {
        let mut config = WidgetConfig {
            memory_scheme: MemoryScheme::Capsule,
            metrics: vec![WidgetMetricConfig {
                kind: WidgetMetricKind::Memory,
                enabled: true,
                usage_scheme: MemoryScheme::Gauge,
            }],
            ..WidgetConfig::default()
        };
        config.normalize();
        assert_eq!(config.memory_scheme, MemoryScheme::Gauge);
        assert_eq!(
            config
                .metrics
                .iter()
                .find(|metric| metric.kind == WidgetMetricKind::Memory)
                .unwrap()
                .usage_scheme,
            MemoryScheme::Gauge
        );
    }

    #[test]
    fn normalize_discards_legacy_disk_io_metric_without_losing_the_config() {
        let mut config: WidgetConfig = serde_json::from_str(
            r#"{
                "metrics": [
                    { "kind": "disk_io", "enabled": true, "usage_scheme": "capsule" },
                    { "kind": "cpu", "enabled": true, "usage_scheme": "ring" }
                ]
            }"#,
        )
        .unwrap();
        config.normalize();
        assert_eq!(config.metrics.len(), 4);
        assert!(config
            .metrics
            .iter()
            .all(|metric| metric.kind != WidgetMetricKind::DiskIoLegacy));
        assert!(config
            .metrics
            .iter()
            .any(|metric| metric.kind == WidgetMetricKind::Cpu && metric.enabled));
    }
}
