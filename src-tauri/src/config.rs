use crate::{KeyMapping, WidgetConfig};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub const CURRENT_SCHEMA_VERSION: u32 = 6;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub schema_version: u32,
    pub key_mappings: Vec<KeyMapping>,
    pub engine_enabled: bool,
    pub widget_config: WidgetConfig,
    pub minimize_to_tray: bool,
    pub screenshot_config: ScreenshotConfig,
    /// 原始 Scancode Map 的 Base64 备份；仅在 DockMapper 首次接管时写入。
    pub scancode_map_backup: Option<String>,
    pub scancode_map_applied: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ScreenshotConfig {
    pub shortcut: String,
    pub save_directory: Option<String>,
    pub filename_prefix: String,
}

impl Default for ScreenshotConfig {
    fn default() -> Self {
        Self {
            shortcut: "Control+1".into(),
            save_directory: None,
            filename_prefix: "DockMapper".into(),
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            key_mappings: Vec::new(),
            engine_enabled: true,
            widget_config: WidgetConfig::default(),
            minimize_to_tray: true,
            screenshot_config: ScreenshotConfig::default(),
            scancode_map_backup: None,
            scancode_map_applied: false,
        }
    }
}

pub fn load(path: &Path) -> AppConfig {
    let backup_path = backup_path(path);
    let source = if path.exists() {
        path
    } else if backup_path.exists() {
        &backup_path
    } else {
        return AppConfig::default();
    };

    let mut config = fs::read_to_string(source)
        .ok()
        .and_then(|content| serde_json::from_str::<AppConfig>(&content).ok())
        .unwrap_or_default();
    migrate(&mut config);
    config
}

pub fn save(path: &Path, config: &AppConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建配置目录失败：{error}"))?;
    }

    let temp_path = path.with_extension("json.tmp");
    let backup_path = backup_path(path);
    let json =
        serde_json::to_vec_pretty(config).map_err(|error| format!("序列化配置失败：{error}"))?;

    let mut temp = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temp_path)
        .map_err(|error| format!("创建临时配置失败：{error}"))?;
    temp.write_all(&json)
        .and_then(|_| temp.sync_all())
        .map_err(|error| format!("写入临时配置失败：{error}"))?;

    if path.exists() {
        let _ = fs::remove_file(&backup_path);
        fs::rename(path, &backup_path).map_err(|error| format!("备份旧配置失败：{error}"))?;
    }

    if let Err(error) = fs::rename(&temp_path, path) {
        if backup_path.exists() {
            let _ = fs::rename(&backup_path, path);
        }
        return Err(format!("替换配置失败：{error}"));
    }

    let _ = fs::remove_file(backup_path);
    Ok(())
}

pub fn normalize_screenshot_config(config: &mut ScreenshotConfig) {
    config.filename_prefix = config
        .filename_prefix
        .trim()
        .chars()
        .filter(|character| {
            !matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
        })
        .take(48)
        .collect();
    if config.filename_prefix.is_empty() {
        config.filename_prefix = ScreenshotConfig::default().filename_prefix;
    }
    if config
        .save_directory
        .as_ref()
        .is_some_and(|directory| directory.trim().is_empty())
    {
        config.save_directory = None;
    }
}

fn migrate(config: &mut AppConfig) {
    config.widget_config.refresh_interval_secs =
        config.widget_config.refresh_interval_secs.clamp(1, 5);
    if config.screenshot_config.shortcut == "Control+Shift+A" {
        config.screenshot_config.shortcut = "Control+1".into();
    }
    normalize_screenshot_config(&mut config.screenshot_config);
    config.schema_version = CURRENT_SCHEMA_VERSION;
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_preserves_disabled_mapping() {
        let path = std::env::temp_dir().join(format!(
            "dock-mapper-config-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        let config = AppConfig {
            engine_enabled: false,
            widget_config: WidgetConfig {
                refresh_interval_secs: 4,
                ..WidgetConfig::default()
            },
            key_mappings: vec![KeyMapping {
                id: "stable-id".into(),
                source_key: crate::KeyCode::KeyA,
                target_key: crate::KeyCode::KeyB,
                enabled: false,
            }],
            ..AppConfig::default()
        };

        save(&path, &config).expect("save config");
        let loaded = load(&path);
        assert_eq!(loaded.key_mappings[0].id, "stable-id");
        assert!(!loaded.key_mappings[0].enabled);
        assert!(!loaded.engine_enabled);
        assert_eq!(loaded.widget_config.refresh_interval_secs, 4);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn migrates_legacy_screenshot_shortcut_to_fixed_ctrl_1() {
        let mut config = AppConfig {
            screenshot_config: ScreenshotConfig {
                shortcut: "Control+Shift+A".into(),
                ..ScreenshotConfig::default()
            },
            ..AppConfig::default()
        };

        migrate(&mut config);

        assert_eq!(config.screenshot_config.shortcut, "Control+1");
        assert_eq!(config.schema_version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn screenshot_defaults_are_normalized_for_safe_file_names() {
        let mut config = AppConfig {
            screenshot_config: ScreenshotConfig {
                filename_prefix: " <Dock:Mapper?> ".into(),
                save_directory: Some("   ".into()),
                ..ScreenshotConfig::default()
            },
            ..AppConfig::default()
        };
        migrate(&mut config);
        assert_eq!(config.screenshot_config.filename_prefix, "DockMapper");
        assert_eq!(config.screenshot_config.save_directory, None);
    }
}
