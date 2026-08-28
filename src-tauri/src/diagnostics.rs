use crate::AppState;
use serde::Serialize;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager, State};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

const LOG_RETENTION_FILES: usize = 7;
const MAX_EXPORTED_LOG_BYTES: usize = 2 * 1024 * 1024;

pub struct DiagnosticsState {
    _guard: WorkerGuard,
    log_dir: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SanitizedConfig {
    mapping_count: usize,
    memory_scheme: crate::MemoryScheme,
    refresh_interval_secs: u8,
    has_selected_network_interface: bool,
    minimize_to_tray: bool,
    screenshot_shortcut: String,
    has_custom_save_directory: bool,
    color_copy_format: crate::config::ColorCopyFormat,
    scancode_map_applied: bool,
    backup_available: bool,
    transient_image_count: usize,
    transient_image_bytes: usize,
    screenshot_history_count: usize,
}

pub fn initialize(app: &AppHandle) -> Result<DiagnosticsState, String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("无法定位日志目录：{error}"))?;
    fs::create_dir_all(&log_dir).map_err(|error| format!("创建日志目录失败：{error}"))?;
    prune_logs(&log_dir);
    let appender = tracing_appender::rolling::daily(&log_dir, "dockmapper.log");
    let (writer, guard) = tracing_appender::non_blocking(appender);
    let subscriber = tracing_subscriber::registry()
        .with(EnvFilter::new("dock_mapper=info"))
        .with(fmt::layer().with_ansi(false).with_writer(writer));
    let _ = subscriber.try_init();
    Ok(DiagnosticsState {
        _guard: guard,
        log_dir,
    })
}

pub fn export(
    app: &AppHandle,
    state: State<'_, AppState>,
    diagnostics: State<'_, DiagnosticsState>,
) -> Result<Option<String>, String> {
    let config = state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())?
        .clone();
    let (transient_image_count, transient_image_bytes) = state.images.stats()?;
    let screenshot_history_count = state.history.list()?.len();
    let sanitized = SanitizedConfig {
        mapping_count: config.key_mappings.len(),
        memory_scheme: config.widget_config.memory_scheme,
        refresh_interval_secs: config.widget_config.refresh_interval_secs,
        has_selected_network_interface: config.widget_config.network_interface.is_some(),
        minimize_to_tray: config.minimize_to_tray,
        screenshot_shortcut: config.screenshot_config.shortcut,
        has_custom_save_directory: config.screenshot_config.save_directory.is_some(),
        color_copy_format: config.screenshot_config.color_copy_format,
        scancode_map_applied: config.scancode_map_applied,
        backup_available: config.scancode_map_backup.is_some(),
        transient_image_count,
        transient_image_bytes,
        screenshot_history_count,
    };
    let Some(path) = rfd::FileDialog::new()
        .set_title("导出 DockMapper 诊断信息")
        .set_file_name("DockMapper-diagnostics.txt")
        .add_filter("Text", &["txt"])
        .save_file()
    else {
        return Ok(None);
    };
    let version = app.package_info().version.to_string();
    let mut report = format!(
        "DockMapper diagnostics\nversion={version}\nos={}\narch={}\n\nconfig={}\n\nlogs:\n",
        std::env::consts::OS,
        std::env::consts::ARCH,
        serde_json::to_string_pretty(&sanitized).map_err(|error| error.to_string())?
    );
    let mut remaining = MAX_EXPORTED_LOG_BYTES;
    for path in log_files_newest_first(&diagnostics.log_dir) {
        if remaining == 0 {
            break;
        }
        let Ok(bytes) = fs::read(&path) else { continue };
        let start = bytes.len().saturating_sub(remaining);
        report.push_str("\n--- log ---\n");
        report.push_str(&redact_sensitive_text(&String::from_utf8_lossy(
            &bytes[start..],
        )));
        remaining = remaining.saturating_sub(bytes.len() - start);
    }
    fs::write(&path, report).map_err(|error| format!("写入诊断信息失败：{error}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn redact_sensitive_text(value: &str) -> String {
    let mut redacted = value.to_owned();
    for key in ["USERPROFILE", "USERNAME"] {
        if let Ok(secret) = std::env::var(key) {
            if !secret.is_empty() {
                redacted = redacted.replace(
                    &secret,
                    if key == "USERNAME" {
                        "<user>"
                    } else {
                        "<user-dir>"
                    },
                );
            }
        }
    }
    redacted
        .lines()
        .map(|line| {
            line.split_whitespace()
                .map(|token| {
                    let bytes = token.as_bytes();
                    if bytes.len() >= 3
                        && bytes[0].is_ascii_alphabetic()
                        && bytes[1] == b':'
                        && matches!(bytes[2], b'\\' | b'/')
                    {
                        "<path>"
                    } else {
                        token
                    }
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn log_files_newest_first(log_dir: &PathBuf) -> Vec<PathBuf> {
    let mut files = fs::read_dir(log_dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .collect::<Vec<_>>();
    files.sort_by_key(|path| fs::metadata(path).and_then(|value| value.modified()).ok());
    files.reverse();
    files
}

fn prune_logs(log_dir: &PathBuf) {
    let files = log_files_newest_first(log_dir);
    for path in files.into_iter().skip(LOG_RETENTION_FILES) {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_logs_redact_absolute_windows_paths() {
        let redacted = redact_sensitive_text(r#"error reading C:\Users\person\secret.png"#);
        assert!(!redacted.contains("C:\\"));
        assert!(!redacted.contains("secret.png"));
    }
}
