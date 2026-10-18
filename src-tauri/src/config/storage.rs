use super::{normalize_loaded_config, AppConfig};
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

/// The installer replaces this token on every successful installation, including
/// reinstalling the same version. Normal launches preserve the user's settings.
pub fn load_for_installation(
    path: &Path,
    token_path: &Path,
) -> std::io::Result<(AppConfig, Option<String>, bool)> {
    let previous = load(path);
    let token = match fs::read_to_string(token_path) {
        Ok(token) if !token.trim().is_empty() => token.trim().to_owned(),
        Ok(_) => return Err(std::io::Error::other("安装设置标记为空")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((previous, None, false))
        }
        Err(error) => return Err(error),
    };
    if previous.installation_id.as_deref() == Some(&token) {
        if read_config(&backup_path(path))
            .is_none_or(|backup| backup.installation_id.as_deref() != Some(&token))
        {
            save(path, &previous).map_err(std::io::Error::other)?;
            fs::copy(path, backup_path(path))?;
        }
        return Ok((previous, Some(token), false));
    }
    let mut defaults = AppConfig::default();
    defaults.installation_id = Some(token.clone());
    // These describe system recovery, not UI preferences. Never discard the
    // only backup of a keyboard mapping which was applied to Windows.
    defaults.scancode_map_backup = previous.scancode_map_backup;
    defaults.applied_scancode_map = previous.applied_scancode_map;
    save(path, &defaults).map_err(std::io::Error::other)?;
    // A damaged primary must not resurrect preferences from before installation.
    fs::copy(path, backup_path(path))?;
    Ok((defaults, Some(token), true))
}

pub fn load_for_mutation(path: &Path) -> Result<AppConfig, String> {
    let backup_path = backup_path(path);
    let mut config = read_config(path)
        .or_else(|| read_config(&backup_path))
        .ok_or_else(|| "主配置与备份均无法读取，已取消系统映射操作".to_string())?;
    normalize_loaded_config(&mut config);
    Ok(config)
}

/// Commit the default identity to both copies before any renderer reads settings.
pub fn load_for_build(path: &Path, build_id: &str) -> Result<(AppConfig, bool), String> {
    let previous = load(path);
    let reset = previous.defaults_build_id.as_deref() != Some(build_id);
    let config = if reset {
        AppConfig {
            defaults_build_id: Some(build_id.to_owned()),
            installation_id: previous.installation_id,
            scancode_map_backup: previous.scancode_map_backup,
            applied_scancode_map: previous.applied_scancode_map,
            ..AppConfig::default()
        }
    } else {
        previous
    };
    if reset {
        save(path, &config)?;
    }
    if reset
        || read_config(&backup_path(path))
            .is_none_or(|backup| backup.defaults_build_id.as_deref() != Some(build_id))
    {
        fs::copy(path, backup_path(path))
            .map_err(|error| format!("同步默认配置备份失败：{error}"))?;
    }
    Ok((config, reset))
}

pub fn save(path: &Path, config: &AppConfig) -> Result<(), String> {
    let span = tracing::info_span!(target: "dock_mapper::config", "save_config");
    let _entered = span.enter();
    let started = std::time::Instant::now();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建配置目录失败：{error}"))?;
    }

    let temporary_path = path.with_extension("json.tmp");
    let backup_path = backup_path(path);
    let json =
        serde_json::to_vec_pretty(config).map_err(|error| format!("序列化配置失败：{error}"))?;
    write_synced(&temporary_path, &json)?;
    replace_config_file(path, &temporary_path, &backup_path)?;
    tracing::debug!(
        target: "dock_mapper::config",
        elapsed_ms = started.elapsed().as_millis(),
        "Configuration saved"
    );
    Ok(())
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

fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut temporary = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("创建临时配置失败：{error}"))?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.sync_all())
        .map_err(|error| format!("写入临时配置失败：{error}"))?;
    // Windows ReplaceFileW requires the replacement file handle to be closed.
    drop(temporary);
    Ok(())
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

#[cfg(test)]
mod installation_tests {
    use super::*;
    #[test]
    fn new_build_resets_all_preferences_once_and_keeps_history_and_system_recovery() {
        let root = std::env::temp_dir().join(format!(
            "dockmapper-build-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("config.json");
        let history = root.join("history.png");
        fs::write(&history, b"history-kept").unwrap();
        let mut previous = AppConfig::default();
        previous.installation_id = Some("install-A".into());
        previous.scancode_map_backup = Some("registry-backup".into());
        previous.applied_scancode_map = Some("applied-map".into());
        previous.key_visualizer_config.enabled = true;
        save(&path, &previous).unwrap();
        let (mut config, reset) = load_for_build(&path, "build-A").unwrap();
        assert!(reset);
        assert!(!config.key_visualizer_config.enabled);
        assert_eq!(
            config.scancode_map_backup.as_deref(),
            Some("registry-backup")
        );
        assert_eq!(config.applied_scancode_map.as_deref(), Some("applied-map"));
        assert_eq!(config.installation_id.as_deref(), Some("install-A"));
        config
            .screenshot_config
            .annotation_styles
            .arrow
            .stroke_color = "#000000".into();
        config.key_visualizer_config.enabled = true;
        config.color_palette.favorites = (0..128).map(|index| format!("#{index:06X}")).collect();
        save(&path, &config).unwrap();
        let (reopened, reset) = load_for_build(&path, "build-A").unwrap();
        assert!(!reset);
        assert!(reopened.key_visualizer_config.enabled);
        assert_eq!(reopened.color_palette.favorites.len(), 128);
        assert_eq!(
            reopened
                .screenshot_config
                .annotation_styles
                .arrow
                .stroke_color,
            "#000000"
        );
        let (new_build, reset) = load_for_build(&path, "build-B").unwrap();
        assert!(reset);
        assert!(!new_build.key_visualizer_config.enabled);
        assert!(new_build.color_palette.favorites.is_empty());
        assert_eq!(
            new_build
                .screenshot_config
                .annotation_styles
                .arrow
                .stroke_color,
            "#e03131"
        );
        fs::write(&path, "corrupt-primary").unwrap();
        let recovered = load(&path);
        assert_eq!(recovered.defaults_build_id.as_deref(), Some("build-B"));
        assert_eq!(
            recovered
                .screenshot_config
                .annotation_styles
                .arrow
                .stroke_width,
            6.0
        );
        assert_eq!(fs::read(&history).unwrap(), b"history-kept");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_build_reset_does_not_report_success_and_remains_retryable() {
        let root = std::env::temp_dir().join(format!(
            "dockmapper-reset-failure-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = root.join("config.json");
        fs::create_dir_all(&path).unwrap();
        assert!(load_for_build(&path, "build-A").is_err());
        fs::remove_dir(&path).unwrap();
        let (_, reset) = load_for_build(&path, "build-A").unwrap();
        assert!(reset);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reinstall_resets_preferences_and_backup_but_normal_launch_keeps_edits() {
        let root = std::env::temp_dir().join(format!(
            "dockmapper-install-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("config.json");
        let token = root.join("settings-reset.token");
        let mut previous = AppConfig::default();
        previous
            .screenshot_config
            .annotation_styles
            .arrow
            .stroke_color = "#000000".into();
        previous.screenshot_config.annotation_styles.arrow.roughness = 0;
        previous.scancode_map_backup = Some("system-recovery".into());
        save(&path, &previous).unwrap();
        fs::write(&token, "installation-A").unwrap();
        let (mut current, _, reset) = load_for_installation(&path, &token).unwrap();
        assert!(reset);
        assert_eq!(
            current
                .screenshot_config
                .annotation_styles
                .arrow
                .stroke_color,
            "#e03131"
        );
        assert_eq!(
            current.screenshot_config.annotation_styles.arrow.roughness,
            2
        );
        assert_eq!(
            current.scancode_map_backup.as_deref(),
            Some("system-recovery")
        );
        current.screenshot_config.filename_prefix = "my-new-settings".into();
        current.color_palette.favorites = (0..128).map(|index| format!("#{index:06X}")).collect();
        save(&path, &current).unwrap();
        let (reopened, _, reset) = load_for_installation(&path, &token).unwrap();
        assert!(!reset);
        assert_eq!(reopened.color_palette.favorites.len(), 128);
        assert_eq!(
            reopened.screenshot_config.filename_prefix,
            "my-new-settings"
        );
        // A reinstall of the very same version has a different installation ID.
        fs::write(&token, "installation-B").unwrap();
        let (reset_config, _, reset) = load_for_installation(&path, &token).unwrap();
        assert!(reset);
        assert_eq!(reset_config.screenshot_config.filename_prefix, "DockMapper");
        assert!(reset_config.color_palette.favorites.is_empty());
        fs::write(&path, "corrupt").unwrap();
        assert_eq!(load(&path).screenshot_config.filename_prefix, "DockMapper");
        for file in [&path, &token, &backup_path(&path)] {
            fs::remove_file(file).unwrap();
        }
        fs::remove_dir(root).unwrap();
    }
}

fn wide_path(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

fn replace_config_file(
    path: &Path,
    temporary_path: &Path,
    backup_path: &Path,
) -> Result<(), String> {
    if !path.exists() {
        return fs::rename(temporary_path, path).map_err(|error| format!("创建配置失败：{error}"));
    }
    // Never overwrite the last known-good backup with a corrupt primary.
    if read_config(path).is_some() {
        fs::copy(path, backup_path).map_err(|error| format!("备份旧配置失败：{error}"))?;
    }
    let path_wide = wide_path(path);
    let temporary_wide = wide_path(temporary_path);
    unsafe {
        ReplaceFileW(
            PCWSTR(path_wide.as_ptr()),
            PCWSTR(temporary_wide.as_ptr()),
            PCWSTR::null(),
            REPLACEFILE_WRITE_THROUGH,
            None,
            None,
        )
    }
    .map_err(|error| format!("原子替换配置失败：{error}"))
}

#[cfg(test)]
pub(super) fn test_backup_path(path: &Path) -> PathBuf {
    backup_path(path)
}

#[cfg(test)]
pub(super) fn test_read_config(path: &Path) -> Option<AppConfig> {
    read_config(path)
}
