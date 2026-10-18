use crate::{config, scancode_mapper};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LegacyRule {
    pub source: String,
    pub target: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Preview {
    pub present: bool,
    pub value: Option<String>,
    pub rules: Vec<LegacyRule>,
    pub parse_error: Option<String>,
    pub waiting_restart: bool,
}
#[derive(Serialize, Deserialize)]
struct Recovery {
    boot_time: u64,
    value: Option<String>,
    config: config::AppConfig,
    #[serde(default)]
    registry_read_error: Option<String>,
}

fn directory(path: &Path) -> Result<PathBuf, String> {
    Ok(path
        .parent()
        .ok_or("配置目录无效")?
        .join("keyboard-recovery"))
}
fn backup(
    path: &Path,
    prefix: &str,
    config: &config::AppConfig,
    value: Option<&[u8]>,
    boot_time: u64,
) -> Result<(), String> {
    backup_with_error(path, prefix, config, value, boot_time, None)
}
fn backup_with_error(
    path: &Path,
    prefix: &str,
    config: &config::AppConfig,
    value: Option<&[u8]>,
    boot_time: u64,
    registry_read_error: Option<String>,
) -> Result<(), String> {
    let directory = directory(path)?;
    fs::create_dir_all(&directory).map_err(|e| format!("无法创建键盘恢复目录：{e}"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let stem = format!("{prefix}-{}-{nonce}", std::process::id());
    let temporary = directory.join(format!("{stem}.tmp"));
    let bytes = serde_json::to_vec_pretty(&Recovery {
        boot_time,
        value: scancode_mapper::backup_encode(value),
        config: config.clone(),
        registry_read_error,
    })
    .map_err(|e| e.to_string())?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|e| format!("无法备份旧映射：{e}"))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("旧映射备份写入失败：{e}"))?;
    drop(file);
    fs::rename(temporary, directory.join(format!("{stem}.json")))
        .map_err(|e| format!("旧映射备份提交失败：{e}"))
}
pub fn migrate(path: &Path, config: &mut config::AppConfig) -> Result<(), String> {
    if config.key_mapping_runtime_version >= 1 {
        return Ok(());
    }
    match scancode_mapper::read() {
        Ok(raw) => migrate_with(path, config, raw.as_deref(), sysinfo::System::boot_time()),
        Err(error) => {
            tracing::error!(%error, "Legacy registry read failed; saved rules backed up separately and runtime remains blocked");
            backup_with_error(
                path,
                "migration",
                config,
                None,
                sysinfo::System::boot_time(),
                Some(error),
            )?;
            finish_migration(path, config)
        }
    }
}
fn migrate_with(
    path: &Path,
    config: &mut config::AppConfig,
    raw: Option<&[u8]>,
    boot: u64,
) -> Result<(), String> {
    if config.key_mapping_runtime_version >= 1 {
        return Ok(());
    }
    backup(path, "migration", config, raw, boot)?;
    finish_migration(path, config)
}
fn finish_migration(path: &Path, config: &mut config::AppConfig) -> Result<(), String> {
    let mut next = config.clone();
    next.key_mappings.clear();
    next.key_mapping_runtime_version = 1;
    next.key_mapping_enabled = true;
    config::save(path, &next)?;
    *config = next;
    Ok(())
}
fn waiting_restart(path: &Path, boot: u64) -> Result<bool, String> {
    let directory = directory(path)?;
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("clear-") && name.ends_with(".json") {
            let record: Recovery =
                serde_json::from_slice(&fs::read(entry.path()).map_err(|e| e.to_string())?)
                    .map_err(|e| format!("键盘重启标记无法读取，已暂停映射：{e}"))?;
            if record.boot_time.abs_diff(boot) <= 2 {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
fn name(scan: u16) -> String {
    if scan == 0 {
        return "禁用按键".into();
    }
    crate::supported_keys()
        .into_iter()
        .find(|key| scancode_mapper::scan_code(key.code).is_some_and(|s| s.0 == scan))
        .map(|key| key.label.to_string())
        .unwrap_or_else(|| format!("0x{scan:04X}"))
}
pub fn decode(bytes: &[u8]) -> Result<Vec<LegacyRule>, String> {
    if bytes.len() < 16 || bytes[..8] != [0; 8] {
        return Err("Scancode Map 头部或长度无效，仍可备份后清空".into());
    }
    let count = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    if count == 0
        || count.checked_mul(4).and_then(|n| n.checked_add(12)) != Some(bytes.len())
        || bytes[bytes.len() - 4..] != [0; 4]
    {
        return Err("Scancode Map 记录数或结束标记无效，仍可备份后清空".into());
    }
    Ok(bytes[12..bytes.len() - 4]
        .chunks_exact(4)
        .map(|pair| LegacyRule {
            source: name(u16::from_le_bytes([pair[2], pair[3]])),
            target: name(u16::from_le_bytes([pair[0], pair[1]])),
        })
        .collect())
}
pub fn preview(path: &Path) -> Result<Preview, String> {
    let raw = scancode_mapper::read()?;
    let parsed = raw.as_deref().map(decode).transpose();
    let (rules, parse_error) = match parsed {
        Ok(rows) => (rows.unwrap_or_default(), None),
        Err(error) => (Vec::new(), Some(error)),
    };
    Ok(Preview {
        present: raw.is_some(),
        value: scancode_mapper::backup_encode(raw.as_deref()),
        rules,
        parse_error,
        waiting_restart: waiting_restart(path, sysinfo::System::boot_time())?,
    })
}
pub fn prepare_clear(path: &Path, expected: Option<&[u8]>) -> Result<(), String> {
    let current = scancode_mapper::read()?;
    if current.as_deref() != expected {
        return Err("系统映射已变化，请刷新预览后重新确认".into());
    }
    let config = config::load_for_mutation(path)?;
    // Write before requesting elevation: cancelling UAC must retain a recovery copy.
    backup(
        path,
        "prepare",
        &config,
        current.as_deref(),
        sysinfo::System::boot_time(),
    )
}
pub fn clear(path: &Path, expected: Option<&[u8]>) -> Result<(), String> {
    let mut config = config::load_for_mutation(path)?;
    clear_with(
        path,
        &mut config,
        expected,
        sysinfo::System::boot_time(),
        scancode_mapper::read,
        scancode_mapper::write,
    )
}
fn clear_with(
    path: &Path,
    config: &mut config::AppConfig,
    expected: Option<&[u8]>,
    boot: u64,
    mut read: impl FnMut() -> Result<Option<Vec<u8>>, String>,
    mut write: impl FnMut(Option<&[u8]>) -> Result<(), String>,
) -> Result<(), String> {
    let current = read()?;
    if current.as_deref() != expected {
        return Err("系统映射已变化，请刷新预览后重新确认".into());
    }
    backup(path, "clear", config, current.as_deref(), boot)?;
    if read()?.as_deref() != expected {
        return Err("备份期间系统映射已变化，请刷新后重试".into());
    }
    let mut next = config.clone();
    next.key_mappings.clear();
    next.key_mapping_runtime_version = 1;
    next.applied_scancode_map = None;
    crate::config_transaction::commit_scancode_change_with(
        current.as_deref(),
        None,
        &next,
        &mut write,
        |config| config::save(path, config),
    )?;
    if read()?.is_some() {
        return Err("清理后系统映射再次出现，请关闭其他映射工具并重试".into());
    }
    *config = next;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_runtime_version_is_legacy_but_new_preferences_use_current_version() {
        let old: config::AppConfig = serde_json::from_str("{}").unwrap();
        assert_eq!(old.key_mapping_runtime_version, 0);
        assert!(old.key_mapping_enabled);
        assert_eq!(config::AppConfig::default().key_mapping_runtime_version, 1);
    }
    fn root() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "dock-key-migration-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }
    #[test]
    fn legacy_unknown_keys_remain_visible_and_bad_bytes_are_not_reported_as_empty() {
        let bytes = [
            0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0x1d, 0, 0x77, 0xe0, 0, 0, 0, 0,
        ];
        assert_eq!(decode(&bytes).unwrap()[0].source, "0xE077");
        assert!(decode(&bytes[..12]).is_err());
        let mut disabled = bytes;
        disabled[12] = 0;
        disabled[13] = 0;
        assert_eq!(decode(&disabled).unwrap()[0].target, "禁用按键");
        let mut right_alt = bytes;
        right_alt[14] = 0x38;
        right_alt[15] = 0xe0;
        assert_eq!(decode(&right_alt).unwrap()[0].source, "右 Alt");
    }
    #[test]
    fn migration_runs_once_and_keeps_new_runtime_rules() {
        let root = root();
        let path = root.join("config.json");
        let mut config = config::AppConfig::default();
        config.key_mapping_runtime_version = 0;
        config.key_mappings.push(crate::KeyMapping {
            id: "old".into(),
            source_key: crate::KeyCode::KeyA,
            target_key: crate::KeyCode::KeyB,
            enabled: true,
        });
        migrate_with(&path, &mut config, Some(&[1, 2]), 100).unwrap();
        assert!(config.key_mappings.is_empty());
        let recovery_path = fs::read_dir(directory(&path).unwrap())
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let recovery: Recovery = serde_json::from_slice(&fs::read(recovery_path).unwrap()).unwrap();
        assert_eq!(recovery.config.key_mappings[0].id, "old");
        assert_eq!(
            scancode_mapper::backup_decode(recovery.value.as_deref()).unwrap(),
            Some(vec![1, 2])
        );
        config.key_mappings.push(crate::KeyMapping {
            id: "new".into(),
            source_key: crate::KeyCode::KeyA,
            target_key: crate::KeyCode::KeyB,
            enabled: true,
        });
        migrate_with(&path, &mut config, None, 100).unwrap();
        assert_eq!(config.key_mappings.len(), 1);
        assert_eq!(fs::read_dir(directory(&path).unwrap()).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cleanup_checks_preview_and_blocks_same_boot_after_backup() {
        let root = root();
        let path = root.join("config.json");
        let mut config = config::AppConfig::default();
        config::save(&path, &config).unwrap();
        assert!(clear_with(
            &path,
            &mut config,
            Some(&[1]),
            100,
            || Ok(Some(vec![2])),
            |_| panic!("changed value written")
        )
        .is_err());
        let value = std::cell::RefCell::new(Some(vec![1]));
        clear_with(
            &path,
            &mut config,
            Some(&[1]),
            100,
            || Ok(value.borrow().clone()),
            |next| {
                *value.borrow_mut() = next.map(Vec::from);
                Ok(())
            },
        )
        .unwrap();
        assert!(waiting_restart(&path, 100).unwrap());
        assert!(!waiting_restart(&path, 200).unwrap());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn backup_failure_never_writes_registry() {
        let root = root();
        let path = root.join("config.json");
        fs::write(root.join("keyboard-recovery"), b"blocked").unwrap();
        assert!(clear_with(
            &path,
            &mut config::AppConfig::default(),
            None,
            100,
            || Ok(None),
            |_| panic!("registry changed without backup")
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn a_change_during_backup_aborts_before_registry_write() {
        let root = root();
        let path = root.join("config.json");
        let mut reads = 0;
        let error = clear_with(
            &path,
            &mut config::AppConfig::default(),
            Some(&[1]),
            100,
            || {
                reads += 1;
                Ok(Some(vec![reads]))
            },
            |_| panic!("concurrent change overwritten"),
        )
        .unwrap_err();
        assert!(error.contains("备份期间"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cleanup_save_failure_rolls_back_registry_and_keeps_recovery() {
        let root = root();
        let path = root.join("config.json");
        fs::create_dir(&path).unwrap();
        let mut config = config::AppConfig::default();
        let registry = std::cell::RefCell::new(Some(vec![1, 2]));
        assert!(clear_with(
            &path,
            &mut config,
            Some(&[1, 2]),
            100,
            || Ok(registry.borrow().clone()),
            |value| {
                *registry.borrow_mut() = value.map(Vec::from);
                Ok(())
            }
        )
        .is_err());
        assert_eq!(*registry.borrow(), Some(vec![1, 2]));
        assert_eq!(fs::read_dir(directory(&path).unwrap()).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn build_and_installation_resets_keep_recovery_but_reset_runtime_preferences() {
        let root = root();
        let path = root.join("config.json");
        let token = root.join("install.token");
        let mut config = config::AppConfig::default();
        config.key_mapping_enabled = false;
        config.key_mappings.push(crate::KeyMapping {
            id: "runtime".into(),
            source_key: crate::KeyCode::KeyA,
            target_key: crate::KeyCode::KeyB,
            enabled: true,
        });
        config.defaults_build_id = Some("A".into());
        config::save(&path, &config).unwrap();
        backup(&path, "clear", &config, Some(&[1]), 100).unwrap();
        let (normal, reset) = config::load_for_build(&path, "A").unwrap();
        assert!(!reset);
        assert_eq!(normal.key_mappings.len(), 1);
        assert!(!normal.key_mapping_enabled);
        let (new_build, reset) = config::load_for_build(&path, "B").unwrap();
        assert!(reset);
        assert!(new_build.key_mappings.is_empty());
        assert!(new_build.key_mapping_enabled);
        fs::write(&token, b"new-install").unwrap();
        config::load_for_installation(&path, &token).unwrap();
        assert!(waiting_restart(&path, 100).unwrap());
        fs::remove_dir_all(root).unwrap();
    }
}
