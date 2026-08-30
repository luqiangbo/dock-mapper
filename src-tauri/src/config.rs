use crate::{KeyMapping, WidgetConfig};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
};
use windows::{
    core::PCWSTR,
    Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_WRITE_THROUGH},
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ColorCopyFormat {
    Hex,
    Rgb,
    Hsl,
    Hsv,
    Css,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CaptureSizeUnit {
    Px,
    Dip,
}

impl Default for CaptureSizeUnit {
    fn default() -> Self {
        Self::Px
    }
}

/// Persisted colour swatches are deliberately small and canonical.  Keeping
/// them in the existing JSON transaction means they remain available offline
/// without introducing a second storage backend.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct ColorPaletteConfig {
    pub recent: Vec<String>,
    pub favorites: Vec<String>,
}

impl Default for ColorCopyFormat {
    fn default() -> Self {
        Self::Hex
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub key_mappings: Vec<KeyMapping>,
    pub widget_config: WidgetConfig,
    pub minimize_to_tray: bool,
    pub screenshot_config: ScreenshotConfig,
    pub color_palette: ColorPaletteConfig,
    /// 接管前 Scancode Map 的 Base64 备份；外部修改后再次接管时会更新。
    pub scancode_map_backup: Option<String>,
    /// DockMapper 最后一次成功写入的 Scancode Map，用于区分草稿与外部修改。
    pub applied_scancode_map: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ScreenshotConfig {
    pub shortcut: String,
    pub pin_shortcut: String,
    pub history_shortcut: String,
    pub toggle_pin_shortcut: String,
    pub quick_ocr_shortcut: String,
    pub save_directory: Option<String>,
    pub filename_prefix: String,
    pub color_copy_format: ColorCopyFormat,
    /// The size unit preferred by the capture overlay. PNG export is always
    /// physical pixels; DIP is only an editing/display convenience.
    pub capture_size_unit: CaptureSizeUnit,
}

impl Default for ScreenshotConfig {
    fn default() -> Self {
        Self {
            shortcut: "Control+1".into(),
            pin_shortcut: "Control+2".into(),
            history_shortcut: "Control+3".into(),
            toggle_pin_shortcut: "Control+Alt+P".into(),
            quick_ocr_shortcut: "Control+Shift+1".into(),
            save_directory: None,
            filename_prefix: "DockMapper".into(),
            color_copy_format: ColorCopyFormat::Hex,
            capture_size_unit: CaptureSizeUnit::Px,
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            key_mappings: Vec::new(),
            widget_config: WidgetConfig::default(),
            minimize_to_tray: true,
            screenshot_config: ScreenshotConfig::default(),
            color_palette: ColorPaletteConfig::default(),
            scancode_map_backup: None,
            applied_scancode_map: None,
        }
    }
}

pub fn load(path: &Path) -> AppConfig {
    let backup_path = backup_path(path);
    let primary = read_config(path);
    let backup = if primary.is_none() {
        read_config(&backup_path)
    } else {
        None
    };
    let mut config = primary.or(backup).unwrap_or_else(|| {
        if path.exists() || backup_path.exists() {
            tracing::error!(target: "dock_mapper::config", "主配置与备份均无法读取，使用默认配置");
        }
        AppConfig::default()
    });
    normalize_loaded_config(&mut config);
    config
}

pub fn load_for_mutation(path: &Path) -> Result<AppConfig, String> {
    let backup_path = backup_path(path);
    let mut config = read_config(path)
        .or_else(|| read_config(&backup_path))
        .ok_or_else(|| "主配置与备份均无法读取，已取消系统映射操作".to_string())?;
    normalize_loaded_config(&mut config);
    Ok(config)
}

fn read_config(path: &Path) -> Option<AppConfig> {
    if !path.exists() {
        return None;
    }
    match fs::read_to_string(path).and_then(|content| {
        serde_json::from_str::<AppConfig>(&content)
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))
    }) {
        Ok(config) => Some(config),
        Err(error) => {
            tracing::warn!(target: "dock_mapper::config", %error, "配置文件读取失败");
            None
        }
    }
}

pub fn save(path: &Path, config: &AppConfig) -> Result<(), String> {
    let span = tracing::info_span!(target: "dock_mapper::config", "save_config");
    let _entered = span.enter();
    let started = std::time::Instant::now();
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
    // Windows ReplaceFileW requires the replacement file handle to be closed.
    drop(temp);

    replace_config_file(path, &temp_path, &backup_path)?;
    tracing::debug!(
        target: "dock_mapper::config",
        elapsed_ms = started.elapsed().as_millis(),
        "Configuration saved"
    );
    Ok(())
}

fn wide_path(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

fn replace_config_file(path: &Path, temp_path: &Path, backup_path: &Path) -> Result<(), String> {
    if !path.exists() {
        return fs::rename(temp_path, path).map_err(|error| format!("创建配置失败：{error}"));
    }
    // Never overwrite the last known-good backup with a corrupt primary.
    // This matters when the app recovered from `.bak` and the next atomic
    // replacement itself fails.
    if read_config(path).is_some() {
        fs::copy(path, backup_path).map_err(|error| format!("备份旧配置失败：{error}"))?;
    }
    let path_wide = wide_path(path);
    let temp_wide = wide_path(temp_path);
    unsafe {
        ReplaceFileW(
            PCWSTR(path_wide.as_ptr()),
            PCWSTR(temp_wide.as_ptr()),
            PCWSTR::null(),
            REPLACEFILE_WRITE_THROUGH,
            None,
            None,
        )
    }
    .map_err(|error| format!("原子替换配置失败：{error}"))
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

fn normalize_loaded_config(config: &mut AppConfig) {
    config.widget_config.refresh_interval_secs =
        config.widget_config.refresh_interval_secs.clamp(1, 5);
    normalize_screenshot_config(&mut config.screenshot_config);
    normalize_palette(&mut config.color_palette);
    config.widget_config.normalize();
}

pub fn normalize_color(value: &str) -> Option<String> {
    let value = value.trim();
    let hex = value.strip_prefix('#').unwrap_or(value);
    if hex.len() != 6 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("#{}", hex.to_ascii_uppercase()))
}

pub fn normalize_palette(palette: &mut ColorPaletteConfig) {
    let normalize = |values: &mut Vec<String>, limit: usize| {
        let mut unique = Vec::with_capacity(values.len());
        for value in std::mem::take(values) {
            if let Some(value) = normalize_color(&value) {
                if !unique.contains(&value) {
                    unique.push(value);
                }
            }
            if unique.len() == limit {
                break;
            }
        }
        *values = unique;
    };
    normalize(&mut palette.recent, 5);
    normalize(&mut palette.favorites, 5);
}

pub fn record_palette_color(
    palette: &mut ColorPaletteConfig,
    value: &str,
) -> Result<(), String> {
    let color = normalize_color(value).ok_or_else(|| "颜色必须为 #RRGGBB".to_string())?;
    palette.recent.retain(|item| item != &color);
    palette.recent.insert(0, color);
    normalize_palette(palette);
    Ok(())
}

pub fn set_palette_favorite(
    palette: &mut ColorPaletteConfig,
    value: &str,
    favorite: bool,
) -> Result<(), String> {
    let color = normalize_color(value).ok_or_else(|| "颜色必须为 #RRGGBB".to_string())?;
    palette.favorites.retain(|item| item != &color);
    if favorite {
        palette.favorites.insert(0, color);
    }
    normalize_palette(palette);
    Ok(())
}

pub fn clear_recent_palette(palette: &mut ColorPaletteConfig) {
    palette.recent.clear();
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
            applied_scancode_map: Some("AQIDBA==".into()),
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
        assert_eq!(loaded.widget_config.refresh_interval_secs, 4);
        assert_eq!(loaded.applied_scancode_map.as_deref(), Some("AQIDBA=="));
        let _ = fs::remove_file(backup_path(&path));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn falls_back_to_last_valid_backup_when_primary_is_corrupt() {
        let path = std::env::temp_dir().join(format!(
            "dock-mapper-config-fallback-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        let mut first = AppConfig::default();
        first.screenshot_config.filename_prefix = "backup-value".into();
        save(&path, &first).expect("initial config");
        let mut second = first.clone();
        second.screenshot_config.filename_prefix = "current-value".into();
        save(&path, &second).expect("replacement config");
        fs::write(&path, "{not-json").expect("corrupt primary");

        let loaded = load(&path);
        assert_eq!(loaded.screenshot_config.filename_prefix, "backup-value");

        let _ = fs::remove_file(backup_path(&path));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn saving_after_backup_recovery_does_not_replace_backup_with_corrupt_bytes() {
        let path = std::env::temp_dir().join(format!(
            "dock-mapper-config-preserve-backup-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        let mut backup = AppConfig::default();
        backup.screenshot_config.filename_prefix = "last-good".into();
        save(&path, &backup).expect("initial config");
        let mut current = backup.clone();
        current.screenshot_config.filename_prefix = "current".into();
        save(&path, &current).expect("create backup");
        fs::write(&path, "{corrupt").expect("corrupt primary");

        let mut replacement = backup.clone();
        replacement.screenshot_config.filename_prefix = "replacement".into();
        save(&path, &replacement).expect("replace corrupt primary");

        assert_eq!(
            read_config(&backup_path(&path))
                .unwrap()
                .screenshot_config
                .filename_prefix,
            "last-good"
        );
        assert_eq!(load(&path).screenshot_config.filename_prefix, "replacement");
        let _ = fs::remove_file(backup_path(&path));
        let _ = fs::remove_file(path);
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
        normalize_loaded_config(&mut config);
        assert_eq!(config.screenshot_config.filename_prefix, "DockMapper");
        assert_eq!(config.screenshot_config.save_directory, None);
    }

    #[test]
    fn screenshot_size_unit_defaults_to_px_for_existing_config() {
        let config: ScreenshotConfig = serde_json::from_str(
            r#"{"shortcut":"Control+1","color_copy_format":"hex"}"#,
        )
        .expect("old screenshot config remains readable");
        assert_eq!(config.capture_size_unit, CaptureSizeUnit::Px);
    }

    #[test]
    fn screenshot_size_unit_round_trips_through_config_json() {
        let config = ScreenshotConfig {
            capture_size_unit: CaptureSizeUnit::Dip,
            ..ScreenshotConfig::default()
        };
        let restored: ScreenshotConfig = serde_json::from_str(
            &serde_json::to_string(&config).expect("serialize screenshot config"),
        )
        .expect("deserialize screenshot config");
        assert_eq!(restored.capture_size_unit, CaptureSizeUnit::Dip);
    }

    #[test]
    fn mutation_load_refuses_missing_or_corrupt_configuration() {
        let path = std::env::temp_dir().join(format!(
            "dock-mapper-config-mutation-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        assert!(load_for_mutation(&path).is_err());
        fs::write(&path, "{corrupt").expect("write corrupt config");
        assert!(load_for_mutation(&path).is_err());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn palette_normalization_uppercases_deduplicates_and_limits() {
        let mut palette = ColorPaletteConfig {
            recent: vec!["#aabbcc".into(), "AABBCC".into(), "invalid".into()],
            favorites: (0..20).map(|index| format!("#{index:06x}")).collect(),
        };
        normalize_palette(&mut palette);
        assert_eq!(palette.recent, vec!["#AABBCC"]);
        assert_eq!(palette.favorites.len(), 5);
    }

    #[test]
    fn recording_palette_colors_moves_duplicates_to_the_front_and_caps_recent() {
        let mut palette = ColorPaletteConfig::default();
        for index in 0..22 {
            record_palette_color(&mut palette, &format!("#{index:06x}"))
                .expect("record valid color");
        }
        record_palette_color(&mut palette, "#000005").expect("record duplicate");

        assert_eq!(palette.recent.len(), 5);
        assert_eq!(palette.recent[0], "#000005");
        assert_eq!(palette.recent.iter().filter(|color| *color == "#000005").count(), 1);
        assert!(!palette.recent.contains(&"#000000".to_string()));
    }

    #[test]
    fn favorites_survive_recent_history_clear_and_can_be_removed() {
        let mut palette = ColorPaletteConfig::default();
        record_palette_color(&mut palette, "#aabbcc").expect("record color");
        set_palette_favorite(&mut palette, "#aabbcc", true).expect("favorite color");
        clear_recent_palette(&mut palette);

        assert!(palette.recent.is_empty());
        assert_eq!(palette.favorites, vec!["#AABBCC"]);

        set_palette_favorite(&mut palette, "#AABBCC", false).expect("remove favorite");
        assert!(palette.favorites.is_empty());
    }
}
