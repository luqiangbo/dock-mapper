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

pub fn load_for_mutation(path: &Path) -> Result<AppConfig, String> {
    let backup_path = backup_path(path);
    let mut config = read_config(path)
        .or_else(|| read_config(&backup_path))
        .ok_or_else(|| "主配置与备份均无法读取，已取消系统映射操作".to_string())?;
    normalize_loaded_config(&mut config);
    Ok(config)
}

/// Build identities only protect runtime compatibility; they never reset settings.
pub fn load_for_build(path: &Path, _build_id: &str) -> Result<(AppConfig, bool), String> {
    let config = load(path);
    if !path.is_file() {
        save(path, &config)?;
    }
    if config.settings_reset_revision > 0
        && read_config(&backup_path(path))
            .is_none_or(|backup| backup.settings_reset_revision != config.settings_reset_revision)
    {
        write_snapshot(&backup_path(path), &config)?;
    }
    Ok((config, false))
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

/// Explicit reset also replaces the recovery copy so old preferences cannot return.
/// Restore the primary on failure; the caller only publishes a reset after both writes.
pub fn save_reset(path: &Path, next: &AppConfig, previous: &AppConfig) -> Result<(), String> {
    save(path, next)?;
    if let Err(error) = write_snapshot(&backup_path(path), next) {
        let rollback = write_snapshot(path, previous)
            .and_then(|()| write_snapshot(&backup_path(path), previous));
        return Err(match rollback {
            Ok(()) => format!("同步重置备份失败，已恢复原配置：{error}"),
            Err(rollback) => format!("同步重置备份失败：{error}；恢复原配置失败：{rollback}"),
        });
    }
    Ok(())
}

fn write_snapshot(path: &Path, config: &AppConfig) -> Result<(), String> {
    let temporary = path.with_extension("reset.tmp");
    let json = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;
    write_synced(&temporary, &json)?;
    replace_file(path, &temporary)
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
    fn root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "dockmapper-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }
    #[test]
    fn reinstall_and_build_changes_preserve_existing_preferences_and_recovery() {
        let root = root("preserve");
        let path = root.join("config.json");
        let token = root.join("settings-reset.token");
        let mut previous = AppConfig::default();
        previous.key_visualizer_config.enabled = true;
        previous.screenshot_config.filename_prefix = "my-screenshots".into();
        previous.color_palette.favorites = vec!["#123456".into()];
        previous.scancode_map_backup = Some("registry-backup".into());
        previous.applied_scancode_map = Some("applied-map".into());
        save(&path, &previous).unwrap();
        for installation in ["install-A", "install-B", ""] {
            fs::write(&token, installation).unwrap();
            let (config, _, reset) = crate::config::load_for_installation(&path, &token).unwrap();
            assert!(!reset);
            assert!(config.key_visualizer_config.enabled);
            assert_eq!(config.screenshot_config.filename_prefix, "my-screenshots");
        }
        for build in ["build-A", "build-B"] {
            let (config, reset) = load_for_build(&path, build).unwrap();
            assert!(!reset);
            assert!(config.key_visualizer_config.enabled);
            assert_eq!(config.color_palette.favorites, ["#123456"]);
            assert_eq!(
                config.scancode_map_backup.as_deref(),
                Some("registry-backup")
            );
            assert_eq!(config.applied_scancode_map.as_deref(), Some("applied-map"));
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn initial_configuration_write_failure_remains_retryable() {
        let root = root("initial-write");
        let path = root.join("config.json");
        fs::create_dir(&path).unwrap();
        assert!(load_for_build(&path, "build-A").is_err());
        fs::remove_dir(&path).unwrap();
        load_for_build(&path, "build-A").unwrap();
        assert!(read_config(&path).is_some());
        fs::remove_dir_all(root).unwrap();
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
    // Never overwrite the last known-good backup with a corrupt primary.
    if read_config(path).is_some() {
        fs::copy(path, backup_path).map_err(|error| format!("备份旧配置失败：{error}"))?;
    }
    replace_file(path, temporary_path)
}

fn replace_file(path: &Path, temporary_path: &Path) -> Result<(), String> {
    if !path.exists() {
        return fs::rename(temporary_path, path).map_err(|error| format!("创建配置失败：{error}"));
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
