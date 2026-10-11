use crate::{config as app_config, sys_monitor, taskbar, AppState};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryScheme {
    #[default]
    Capsule,
    Ring,
    // Removed presentations remain readable in existing configurations and presets.
    #[serde(alias = "gauge", alias = "bar")]
    Number,
}

pub type UsageScheme = MemoryScheme;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WidgetIconStyle {
    #[default]
    Outline,
    Filled,
    Text,
    /// Read old configurations, then migrate to a visible marker.
    None,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WidgetLayoutMode {
    #[default]
    Auto,
    Standard,
    Compact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct WidgetLayoutSettings {
    pub mode: WidgetLayoutMode,
    pub metric_gap: u8,
    pub horizontal_padding: u8,
    pub task_list_gap: u8,
    pub tray_gap: u8,
    pub vertical_offset: i8,
    pub font_size: u8,
    pub icon_size: u8,
}

impl Default for WidgetLayoutSettings {
    fn default() -> Self {
        Self {
            mode: WidgetLayoutMode::Auto,
            metric_gap: 6,
            horizontal_padding: 4,
            task_list_gap: 6,
            tray_gap: 6,
            vertical_offset: 0,
            font_size: 14,
            icon_size: 18,
        }
    }
}

impl WidgetLayoutSettings {
    pub fn normalize(&mut self) {
        self.metric_gap = self.metric_gap.min(20);
        self.horizontal_padding = self.horizontal_padding.min(16);
        self.task_list_gap = self.task_list_gap.min(40);
        self.tray_gap = self.tray_gap.min(40);
        self.vertical_offset = self.vertical_offset.clamp(-12, 12);
        self.font_size = self.font_size.clamp(12, 18);
        self.icon_size = self.icon_size.clamp(14, 22);
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpeedUnit {
    #[default]
    Auto,
    Kb,
    Mb,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WidgetMetricKind {
    #[default]
    Network,
    Upload,
    Download,
    Cpu,
    CpuTemperature,
    GpuUsage,
    Memory,
    Battery,
    /// Kept only so configurations written by 1.1.0 preview builds can be
    /// loaded and normalized without making the complete config unreadable.
    #[doc(hidden)]
    #[serde(rename = "disk_io")]
    DiskIoLegacy,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WidgetRowLayout {
    /// Legacy configurations choose the previous layout for their metric kind.
    #[default]
    Auto,
    Single,
    Double,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WidgetMetricConfig {
    pub pair_with: Option<WidgetMetricKind>,
    pub row_layout: WidgetRowLayout,
    pub kind: WidgetMetricKind,
    pub enabled: bool,
    pub usage_scheme: UsageScheme,
    pub icon_style: WidgetIconStyle,
}

impl Default for WidgetMetricConfig {
    fn default() -> Self {
        Self {
            pair_with: None,
            row_layout: WidgetRowLayout::Auto,
            kind: WidgetMetricKind::Network,
            enabled: true,
            usage_scheme: UsageScheme::Capsule,
            icon_style: WidgetIconStyle::Outline,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct AlertConfig {
    pub cpu_percent: Option<u8>,
    pub memory_percent: Option<u8>,
    pub battery_below_percent: Option<u8>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct WidgetPreset {
    pub layout: WidgetLayoutSettings,
    pub name: String,
    pub metrics: Vec<WidgetMetricConfig>,
    pub refresh_interval_secs: u8,
    pub speed_unit: SpeedUnit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WidgetConfig {
    pub layout: WidgetLayoutSettings,
    /// Kept for lossless reads of 1.0.5 configuration and API clients.
    pub memory_scheme: MemoryScheme,
    pub metrics: Vec<WidgetMetricConfig>,
    pub refresh_interval_secs: u8,
    /// Retained for backwards-compatible reads. Automatic adapter selection is
    /// now always used and normalization clears any legacy explicit value.
    pub network_interface: Option<String>,
    pub speed_unit: SpeedUnit,
    pub alerts: AlertConfig,
    pub presets: Vec<WidgetPreset>,
}

impl Default for WidgetConfig {
    fn default() -> Self {
        Self {
            layout: WidgetLayoutSettings::default(),
            memory_scheme: MemoryScheme::Capsule,
            metrics: vec![
                WidgetMetricConfig {
                    kind: WidgetMetricKind::Upload,
                    pair_with: Some(WidgetMetricKind::Download),
                    row_layout: WidgetRowLayout::Single,
                    ..WidgetMetricConfig::default()
                },
                WidgetMetricConfig {
                    kind: WidgetMetricKind::Download,
                    pair_with: Some(WidgetMetricKind::Upload),
                    row_layout: WidgetRowLayout::Single,
                    ..WidgetMetricConfig::default()
                },
                WidgetMetricConfig {
                    pair_with: None,
                    row_layout: WidgetRowLayout::Single,
                    kind: WidgetMetricKind::Memory,
                    enabled: true,
                    usage_scheme: MemoryScheme::Capsule,
                    icon_style: WidgetIconStyle::Outline,
                },
            ],
            refresh_interval_secs: 1,
            network_interface: None,
            speed_unit: SpeedUnit::Auto,
            alerts: AlertConfig::default(),
            presets: Vec::new(),
        }
    }
}

impl WidgetConfig {
    pub fn normalize(&mut self) {
        self.layout.normalize();
        for threshold in [
            &mut self.alerts.cpu_percent,
            &mut self.alerts.memory_percent,
            &mut self.alerts.battery_below_percent,
        ] {
            *threshold = threshold.and_then(|value| (value > 0).then_some(value.min(100)));
        }
        let mut names = std::collections::HashSet::new();
        self.presets.retain_mut(|preset| {
            preset.name = preset.name.trim().chars().take(24).collect();
            !preset.name.is_empty() && names.insert(preset.name.to_lowercase())
        });
        self.presets.truncate(8);
        for preset in &mut self.presets {
            let mut normalized = WidgetConfig {
                layout: preset.layout,
                metrics: preset.metrics.clone(),
                refresh_interval_secs: preset.refresh_interval_secs,
                speed_unit: preset.speed_unit,
                ..WidgetConfig::default()
            };
            normalized.normalize();
            preset.metrics = normalized.metrics;
            preset.layout = normalized.layout;
            preset.refresh_interval_secs = normalized.refresh_interval_secs;
        }
        self.refresh_interval_secs = match self.refresh_interval_secs {
            1 | 2 | 3 | 5 => self.refresh_interval_secs,
            0 => 1,
            4 => 3,
            _ => 5,
        };
        self.network_interface = None;
        let mut normalized = Vec::new();
        let previous = std::mem::take(&mut self.metrics);
        // Explicit split metrics win over a legacy combined entry.
        let has_split = previous.iter().any(|m| {
            matches!(
                m.kind,
                WidgetMetricKind::Upload | WidgetMetricKind::Download
            )
        });
        let expanded = previous.into_iter().flat_map(|metric| {
            if metric.kind != WidgetMetricKind::Network {
                return vec![metric];
            }
            if has_split {
                return Vec::new();
            }
            let paired = metric.row_layout != WidgetRowLayout::Single;
            [WidgetMetricKind::Upload, WidgetMetricKind::Download]
                .into_iter()
                .map(|kind| {
                    let mut split = metric.clone();
                    split.kind = kind;
                    split.row_layout = WidgetRowLayout::Single;
                    split.pair_with = paired.then_some(if kind == WidgetMetricKind::Upload {
                        WidgetMetricKind::Download
                    } else {
                        WidgetMetricKind::Upload
                    });
                    split
                })
                .collect()
        });
        for metric in expanded {
            if metric.kind == WidgetMetricKind::DiskIoLegacy {
                continue;
            }
            if !normalized
                .iter()
                .any(|item: &WidgetMetricConfig| item.kind == metric.kind)
            {
                normalized.push(metric);
            }
        }
        let had_metric_config = !normalized.is_empty();
        if normalized.is_empty() {
            normalized = Self::default().metrics;
        }
        for metric in &mut normalized {
            // Rows now contain complete metrics; pairs control the two-row column.
            metric.row_layout = WidgetRowLayout::Single;
            if metric.icon_style == WidgetIconStyle::None {
                metric.icon_style = WidgetIconStyle::Outline;
            }
            if metric.kind == WidgetMetricKind::CpuTemperature
                && !matches!(
                    metric.usage_scheme,
                    UsageScheme::Number | UsageScheme::Capsule
                )
            {
                metric.usage_scheme = UsageScheme::Number;
            }
        }
        for kind in [
            WidgetMetricKind::Upload,
            WidgetMetricKind::Download,
            WidgetMetricKind::Cpu,
            WidgetMetricKind::CpuTemperature,
            WidgetMetricKind::GpuUsage,
            WidgetMetricKind::Memory,
            WidgetMetricKind::Battery,
        ] {
            if !normalized.iter().any(|item| item.kind == kind) {
                normalized.push(WidgetMetricConfig {
                    pair_with: None,
                    row_layout: WidgetRowLayout::Single,
                    kind,
                    enabled: false,
                    usage_scheme: if kind == WidgetMetricKind::CpuTemperature {
                        UsageScheme::Number
                    } else {
                        self.memory_scheme
                    },
                    icon_style: WidgetIconStyle::Outline,
                });
            }
        }
        // A taskbar widget with every switch disabled still owns taskbar
        // space but cannot communicate anything useful. Keep the network
        // metric as a deterministic recovery default.
        if !normalized.iter().any(|item| item.enabled) {
            if let Some(network) = normalized
                .iter_mut()
                .find(|item| item.kind == WidgetMetricKind::Upload)
            {
                network.enabled = true;
            }
        }
        // Only reciprocal, distinct pairs form columns. Invalid/conflicting edges
        // must not steal another metric or turn into a three-row column.
        let pairs: Vec<_> = normalized.iter().map(|m| (m.kind, m.pair_with)).collect();
        for metric in &mut normalized {
            if metric.pair_with.is_some_and(|other| {
                other == metric.kind || !pairs.contains(&(other, Some(metric.kind)))
            }) {
                metric.pair_with = None;
            }
        }
        if let Some(memory) = normalized
            .iter_mut()
            .find(|item| item.kind == WidgetMetricKind::Memory)
        {
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
pub async fn refresh_widget_position(
    app: AppHandle,
) -> Result<taskbar::WidgetLayoutBudget, String> {
    taskbar::refresh(app, None).await
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
pub fn update_widget_config(
    app: AppHandle,
    state: State<'_, AppState>,
    mut config: WidgetConfig,
) -> Result<WidgetConfig, String> {
    let _mutation = state
        .mutation_lock
        .lock()
        .map_err(|_| "配置写入锁已损坏".to_string())?;
    config.normalize();
    commit_widget_config_with(&state.config, &config, |next| {
        app_config::save(&state.config_path, next)
    })?;
    if let Some(control) = app.try_state::<sys_monitor::SysMonitorControl>() {
        control.set_interval(config.refresh_interval_secs);
    }
    taskbar::schedule_refresh(&app);
    app.emit("widget-config-changed", &config)
        .map_err(|error| error.to_string())?;
    Ok(config)
}

fn commit_widget_config_with(
    current: &std::sync::Mutex<app_config::AppConfig>,
    widget_config: &WidgetConfig,
    save: impl FnOnce(&app_config::AppConfig) -> Result<(), String>,
) -> Result<(), String> {
    let mut current = current.lock().map_err(|_| "配置状态已损坏".to_string())?;
    let mut next = current.clone();
    next.widget_config = widget_config.clone();
    // Native refreshes can observe only the last successfully persisted config.
    save(&next)?;
    *current = next;
    Ok(())
}

#[tauri::command]
pub async fn sync_widget_dynamic_width(
    app: AppHandle,
    preferred_width: f64,
    minimum_width: f64,
) -> Result<taskbar::WidgetLayoutBudget, String> {
    taskbar::refresh(
        app,
        Some(taskbar::WidgetLayoutRequest {
            preferred_width,
            minimum_width,
        }),
    )
    .await
}

pub fn setup_window(app: &tauri::App) -> Result<(), String> {
    let widget = app
        .get_webview_window("taskbar_widget")
        .ok_or_else(|| "缺少 taskbar_widget 窗口".to_string())?;
    taskbar::schedule_refresh(app.handle());
    let widget_app = app.handle().clone();
    widget.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::ScaleFactorChanged { .. } | tauri::WindowEvent::Focused(true)
        ) {
            taskbar::schedule_refresh(&widget_app);
        }
    });
    let recovery_app = app.handle().clone();
    std::thread::spawn(move || {
        let pending = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            if recovery_app.get_webview_window("taskbar_widget").is_none() {
                break;
            }
            if pending.swap(true, std::sync::atomic::Ordering::Relaxed) {
                continue;
            }
            let handle = recovery_app.clone();
            let refresh_pending = pending.clone();
            if let Err(error) = recovery_app.run_on_main_thread(move || {
                if let Err(error) = taskbar::refresh_on_main_thread(&handle, None) {
                    tracing::warn!(%error, "挂件原生恢复失败");
                }
                refresh_pending.store(false, std::sync::atomic::Ordering::Relaxed);
            }) {
                tracing::warn!(?error, "挂件恢复调度失败");
                break;
            }
        }
    });
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_network_reopens_as_paired_upload_download_and_gpu_is_off() {
        let mut config: WidgetConfig = serde_json::from_str(
            r#"{
            "metrics":[{"kind":"network","enabled":true,"row_layout":"double","icon_style":"text"}],
            "presets":[{"name":"旧网速","metrics":[{"kind":"network","enabled":true}]}]
        }"#,
        )
        .unwrap();
        config.normalize();
        let saved = serde_json::to_value(&config).unwrap();
        assert_eq!(saved["metrics"][0]["kind"], "upload");
        assert_eq!(saved["metrics"][0]["pair_with"], "download");
        assert_eq!(saved["metrics"][1]["kind"], "download");
        assert_eq!(saved["metrics"][1]["pair_with"], "upload");
        assert_eq!(saved["metrics"][0]["icon_style"], "text");
        assert_eq!(saved["presets"][0]["metrics"][0]["kind"], "upload");
        assert!(
            !config
                .metrics
                .iter()
                .find(|m| m.kind == WidgetMetricKind::GpuUsage)
                .unwrap()
                .enabled
        );
        let mut reopened: WidgetConfig = serde_json::from_value(saved.clone()).unwrap();
        reopened.normalize();
        assert_eq!(serde_json::to_value(reopened).unwrap(), saved);
    }

    #[test]
    fn pairing_round_trips_and_invalid_or_conflicting_pairs_become_single_columns() {
        let mut config: WidgetConfig = serde_json::from_str(
            r#"{
            "metrics":[{"kind":"cpu","enabled":true,"pair_with":"memory"},
                {"kind":"memory","enabled":true,"pair_with":"cpu"},
                {"kind":"battery","enabled":false,"pair_with":"cpu"},
                {"kind":"cpu_temperature","enabled":false,"pair_with":"cpu_temperature"}]
        }"#,
        )
        .unwrap();
        config.normalize();
        let saved = serde_json::to_value(&config).unwrap();
        assert_eq!(saved["metrics"][0]["pair_with"], "memory");
        assert_eq!(saved["metrics"][1]["pair_with"], "cpu");
        assert!(saved["metrics"][2]["pair_with"].is_null());
        assert!(saved["metrics"][3]["pair_with"].is_null());
        let mut reopened: WidgetConfig = serde_json::from_value(saved.clone()).unwrap();
        reopened.normalize();
        assert_eq!(serde_json::to_value(reopened).unwrap(), saved);
    }

    #[test]
    fn removed_bar_and_gauge_styles_reopen_as_numbers_in_settings_and_presets() {
        let mut config: WidgetConfig = serde_json::from_str(r#"{
            "memory_scheme":"gauge",
            "metrics":[{"kind":"cpu","enabled":true,"usage_scheme":"bar"}],
            "presets":[{"name":"旧样式","metrics":[{"kind":"memory","enabled":true,"usage_scheme":"gauge"}]}]
        }"#).unwrap();
        config.normalize();
        let saved = serde_json::to_value(&config).unwrap();
        assert_eq!(saved["memory_scheme"], "number");
        assert_eq!(saved["metrics"][0]["usage_scheme"], "number");
        assert_eq!(saved["presets"][0]["metrics"][0]["usage_scheme"], "number");
        let reopened: WidgetConfig = serde_json::from_value(saved.clone()).unwrap();
        assert_eq!(serde_json::to_value(reopened).unwrap(), saved);
    }

    #[test]
    fn old_hidden_markers_become_visible_and_network_forms_a_paired_column() {
        let mut config: WidgetConfig = serde_json::from_str(
            r#"{
            "metrics":[{"kind":"network","enabled":true,"icon_style":"none"},
                {"kind":"cpu","enabled":true,"icon_style":"none"}],
            "presets":[{"name":"旧配置","metrics":[{"kind":"memory","icon_style":"none"}]}]
        }"#,
        )
        .unwrap();
        config.normalize();
        assert_eq!(
            config.metrics[0].pair_with,
            Some(WidgetMetricKind::Download)
        );
        assert_eq!(config.metrics[1].row_layout, WidgetRowLayout::Single);
        assert!(config
            .metrics
            .iter()
            .all(|m| m.icon_style != WidgetIconStyle::None));
        assert!(config.presets[0]
            .metrics
            .iter()
            .all(|m| m.icon_style != WidgetIconStyle::None));
        assert_eq!(config.layout.font_size, 14);
        assert_eq!(config.layout.icon_size, 18);
    }

    #[test]
    fn legacy_rows_migrate_to_complete_metrics_and_temperature_sizes_survive_reopening() {
        let mut config: WidgetConfig = serde_json::from_str(r#"{
            "layout":{"font_size":16,"icon_size":20},
            "metrics":[{"kind":"network","enabled":true,"row_layout":"single","icon_style":"text"},
                {"kind":"cpu","enabled":true,"row_layout":"double"},
                {"kind":"cpu_temperature","enabled":true,"usage_scheme":"number","row_layout":"double"}]
        }"#).unwrap();
        config.normalize();
        let mut reopened: WidgetConfig =
            serde_json::from_value(serde_json::to_value(&config).unwrap()).unwrap();
        reopened.normalize();
        assert_eq!(reopened.metrics[0].row_layout, WidgetRowLayout::Single);
        assert_eq!(reopened.metrics[0].pair_with, None);
        assert_eq!(reopened.metrics[2].row_layout, WidgetRowLayout::Single);
        assert_eq!(reopened.metrics[3].kind, WidgetMetricKind::CpuTemperature);
        assert!(reopened.metrics[3].enabled);
        assert_eq!(
            (reopened.layout.font_size, reopened.layout.icon_size),
            (16, 20)
        );
        reopened.layout.font_size = 0;
        reopened.layout.icon_size = 255;
        reopened.normalize();
        assert_eq!(
            (reopened.layout.font_size, reopened.layout.icon_size),
            (12, 22)
        );
    }

    #[test]
    fn old_settings_and_presets_gain_default_distances_and_outline_icons() {
        let mut config: WidgetConfig = serde_json::from_str(r#"{
            "metrics":[{"kind":"memory","enabled":true,"usage_scheme":"ring"}],
            "presets":[{"name":"旧预设","metrics":[{"kind":"cpu","enabled":true,"usage_scheme":"gauge"}]}]
        }"#).unwrap();
        config.normalize();
        assert_eq!(config.layout, WidgetLayoutSettings::default());
        assert_eq!(config.metrics[0].usage_scheme, UsageScheme::Ring);
        assert_eq!(config.metrics[0].icon_style, WidgetIconStyle::Outline);
        assert_eq!(config.presets[0].layout, WidgetLayoutSettings::default());
        assert_eq!(
            config.presets[0].metrics[0].icon_style,
            WidgetIconStyle::Outline
        );
    }

    #[test]
    fn custom_distances_icons_and_new_presentations_survive_save_and_read() {
        let mut config: WidgetConfig = serde_json::from_str(r#"{
            "layout":{"mode":"compact","metric_gap":19,"horizontal_padding":12,"task_list_gap":24,"tray_gap":30,"vertical_offset":-7},
            "metrics":[{"kind":"cpu","enabled":true,"usage_scheme":"bar","icon_style":"filled"},
                {"kind":"memory","enabled":true,"usage_scheme":"number","icon_style":"none"}],
            "presets":[{"name":"自定义","layout":{"mode":"standard","metric_gap":15},
                "metrics":[{"kind":"cpu","enabled":true,"usage_scheme":"number","icon_style":"text"}]}]
        }"#).unwrap();
        config.normalize();
        let encoded = serde_json::to_value(&config).unwrap();
        let mut read: WidgetConfig = serde_json::from_value(encoded.clone()).unwrap();
        read.normalize();
        assert_eq!(serde_json::to_value(&read).unwrap(), encoded);
        assert_eq!(read.metrics[0].usage_scheme, UsageScheme::Number);
        assert_eq!(read.metrics[1].icon_style, WidgetIconStyle::Outline);
        assert_eq!(read.presets[0].layout.metric_gap, 15);
    }

    #[test]
    fn settings_and_preset_distances_are_limited_to_safe_ranges() {
        let mut config: WidgetConfig = serde_json::from_str(r#"{
            "layout":{"metric_gap":255,"horizontal_padding":255,"task_list_gap":255,"tray_gap":255,"vertical_offset":-128},
            "presets":[{"name":"上限","layout":{"metric_gap":255,"vertical_offset":127}}]
        }"#).unwrap();
        config.normalize();
        assert_eq!(
            (
                config.layout.metric_gap,
                config.layout.horizontal_padding,
                config.layout.task_list_gap,
                config.layout.tray_gap,
                config.layout.vertical_offset
            ),
            (20, 16, 40, 40, -12)
        );
        assert_eq!(config.presets[0].layout.metric_gap, 20);
        assert_eq!(config.presets[0].layout.vertical_offset, 12);
    }

    #[test]
    fn failed_save_keeps_previous_layout_and_other_settings() {
        let current = std::sync::Mutex::new(app_config::AppConfig::default());
        let before = serde_json::to_value(&*current.lock().unwrap()).unwrap();
        let next = WidgetConfig {
            layout: WidgetLayoutSettings {
                metric_gap: 20,
                ..Default::default()
            },
            ..Default::default()
        };
        let result = commit_widget_config_with(&current, &next, |_| Err("磁盘写入失败".into()));
        assert_eq!(result.unwrap_err(), "磁盘写入失败");
        assert_eq!(
            serde_json::to_value(&*current.lock().unwrap()).unwrap(),
            before
        );
        commit_widget_config_with(&current, &next, |_| Ok(())).unwrap();
        assert_eq!(current.lock().unwrap().widget_config.layout.metric_gap, 20);
    }

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
        let mut config = WidgetConfig {
            metrics: Vec::new(),
            memory_scheme: MemoryScheme::Ring,
            ..WidgetConfig::default()
        };
        config.normalize();
        assert_eq!(config.metrics.len(), 7);
        assert_eq!(config.metrics[2].kind, WidgetMetricKind::Memory);
        assert_eq!(config.metrics[2].usage_scheme, MemoryScheme::Ring);
    }

    #[test]
    fn normalize_keeps_at_least_one_metric_enabled() {
        let mut config = WidgetConfig {
            metrics: vec![
                WidgetMetricConfig {
                    kind: WidgetMetricKind::Network,
                    pair_with: None,
                    enabled: false,
                    usage_scheme: MemoryScheme::Capsule,
                    icon_style: WidgetIconStyle::Outline,
                    row_layout: crate::widget::WidgetRowLayout::Single,
                },
                WidgetMetricConfig {
                    kind: WidgetMetricKind::Memory,
                    pair_with: None,
                    enabled: false,
                    usage_scheme: MemoryScheme::Ring,
                    icon_style: WidgetIconStyle::Outline,
                    row_layout: crate::widget::WidgetRowLayout::Single,
                },
            ],
            ..WidgetConfig::default()
        };
        config.normalize();
        assert!(config
            .metrics
            .iter()
            .any(|metric| metric.kind == WidgetMetricKind::Upload && metric.enabled));
    }

    #[test]
    fn normalize_preserves_a_current_memory_metric_style() {
        let mut config = WidgetConfig {
            memory_scheme: MemoryScheme::Capsule,
            metrics: vec![WidgetMetricConfig {
                kind: WidgetMetricKind::Memory,
                pair_with: None,
                enabled: true,
                usage_scheme: MemoryScheme::Number,
                icon_style: WidgetIconStyle::Outline,
                row_layout: crate::widget::WidgetRowLayout::Single,
            }],
            ..WidgetConfig::default()
        };
        config.normalize();
        assert_eq!(config.memory_scheme, MemoryScheme::Number);
        assert_eq!(
            config
                .metrics
                .iter()
                .find(|metric| metric.kind == WidgetMetricKind::Memory)
                .unwrap()
                .usage_scheme,
            MemoryScheme::Number
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
        assert_eq!(config.metrics.len(), 7);
        assert!(config
            .metrics
            .iter()
            .all(|metric| metric.kind != WidgetMetricKind::DiskIoLegacy));
        assert!(config
            .metrics
            .iter()
            .any(|metric| metric.kind == WidgetMetricKind::Cpu && metric.enabled));
    }

    #[test]
    fn normalize_migrates_explicit_adapter_and_unsupported_intervals_to_safe_options() {
        let mut config = WidgetConfig {
            refresh_interval_secs: 4,
            network_interface: Some("Ethernet".into()),
            speed_unit: SpeedUnit::Mb,
            ..WidgetConfig::default()
        };
        config.normalize();
        assert_eq!(config.refresh_interval_secs, 3);
        assert_eq!(config.network_interface, None);
        assert_eq!(config.speed_unit, SpeedUnit::Mb);
    }

    #[test]
    fn alert_thresholds_and_layout_presets_survive_config_normalization() {
        let mut config: WidgetConfig = serde_json::from_str(r#"{
            "alerts": {"cpu_percent": 85, "memory_percent": 90, "battery_below_percent": 20},
            "presets": [{"name": "办公", "metrics": [{"kind": "cpu", "enabled": true, "usage_scheme": "ring"}], "refresh_interval_secs": 3, "speed_unit": "mb"}]
        }"#).unwrap();
        config.normalize();
        let value = serde_json::to_value(config).unwrap();
        assert_eq!(value["alerts"]["cpu_percent"], 85);
        assert_eq!(value["presets"][0]["name"], "办公");
        assert_eq!(value["presets"][0]["metrics"][0]["kind"], "cpu");
    }
}
