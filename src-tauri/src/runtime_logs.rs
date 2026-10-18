use crate::diagnostics::{redact_sensitive_text, DiagnosticsState};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::Path,
};
use tauri::State;
const MAX_BYTES: usize = 256 * 1024;
const MAX_LINES: usize = 500;
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}
impl LogLevel {
    fn label(self) -> &'static str {
        match self {
            Self::Info => "INFO",
            Self::Warn => "WARN",
            Self::Error => "ERROR",
        }
    }
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogSource {
    Application,
    Screenshot,
    History,
    Ocr,
    Update,
    Settings,
    Monitor,
    KeyMapping,
}
impl LogSource {
    fn label(self) -> &'static str {
        match self {
            Self::Application => "application",
            Self::Screenshot => "screenshot",
            Self::History => "history",
            Self::Ocr => "ocr",
            Self::Update => "update",
            Self::Settings => "settings",
            Self::Monitor => "monitor",
            Self::KeyMapping => "key_mapping",
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    id: String,
    timestamp: String,
    level: LogLevel,
    source: String,
    message: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogSnapshot {
    lines: Vec<LogLine>,
    truncated: bool,
}

fn parse_line(id: String, line: &str) -> LogLine {
    let clean = redact_sensitive_text(line);
    let mut words = clean.splitn(2, ' ');
    let timestamp = words.next().unwrap_or_default();
    let rest = words.next().unwrap_or_default().trim_start();
    let (level, body) = rest.split_once(' ').unwrap_or(("", ""));
    let level = match level {
        "INFO" => Some(LogLevel::Info),
        "WARN" => Some(LogLevel::Warn),
        "ERROR" => Some(LogLevel::Error),
        _ => None,
    };
    if let Some(level) = level {
        let (source, message) = body
            .trim_start()
            .split_once(": ")
            .unwrap_or(("runtime", body));
        let (source, message) = if source == "dock_mapper::frontend" {
            message
                .strip_prefix("source=")
                .and_then(|message| message.split_once(' '))
                .unwrap_or((source, message))
        } else {
            (
                source.strip_prefix("dock_mapper::").unwrap_or(source),
                message,
            )
        };
        LogLine {
            id,
            timestamp: timestamp.to_string(),
            level,
            source: source.to_string(),
            message: message.to_string(),
        }
    } else {
        LogLine {
            id,
            timestamp: String::new(),
            level: LogLevel::Info,
            source: "runtime".into(),
            message: clean,
        }
    }
}
fn read_recent(root: &Path, max_bytes: usize, max_lines: usize) -> Result<LogSnapshot, String> {
    let mut files = fs::read_dir(root)
        .map_err(|error| format!("日志目录读取失败：{error}"))?
        .map(|entry| entry.map_err(|error| error.to_string()))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with("dockmapper.log"))
        })
        .collect::<Vec<_>>();
    files.sort_by_key(|entry| std::cmp::Reverse(entry.file_name()));
    let mut budget = max_bytes;
    let mut newest = Vec::new();
    let mut truncated = false;
    for entry in files {
        if budget == 0 || newest.len() >= max_lines {
            truncated = true;
            break;
        }
        let mut file =
            fs::File::open(entry.path()).map_err(|error| format!("日志文件读取失败：{error}"))?;
        let length = file.metadata().map_err(|error| error.to_string())?.len();
        let start = length.saturating_sub(budget as u64);
        if start > 0 {
            truncated = true;
        }
        file.seek(SeekFrom::Start(start))
            .map_err(|error| error.to_string())?;
        let mut bytes = Vec::new();
        file.take(length - start)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("日志读取失败：{error}"))?;
        budget = budget.saturating_sub(bytes.len());
        let mut offset = start;
        let mut complete = Vec::new();
        let mut context: Option<(String, LogLevel, String)> = None;
        for (index, part) in bytes.split_inclusive(|byte| *byte == b'\n').enumerate() {
            let position = offset;
            offset += part.len() as u64;
            if (start > 0 && index == 0) || !part.ends_with(b"\n") {
                continue;
            }
            let text = String::from_utf8_lossy(part);
            let mut row = parse_line(
                format!("{}:{position}", entry.file_name().to_string_lossy()),
                text.trim_end_matches(['\r', '\n']),
            );
            if row.timestamp.is_empty() {
                if let Some((timestamp, level, source)) = &context {
                    row.timestamp = timestamp.clone();
                    row.level = *level;
                    row.source = source.clone();
                }
            } else {
                context = Some((row.timestamp.clone(), row.level, row.source.clone()));
            }
            complete.push(row);
        }
        complete.reverse();
        let remaining = max_lines.saturating_sub(newest.len());
        if complete.len() > remaining {
            truncated = true;
        }
        newest.extend(complete.into_iter().take(remaining));
    }
    newest.reverse();
    newest.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    Ok(LogSnapshot {
        lines: newest,
        truncated,
    })
}
#[tauri::command]
pub async fn get_runtime_logs(
    diagnostics: State<'_, DiagnosticsState>,
) -> Result<LogSnapshot, String> {
    let root = diagnostics.log_dir.clone();
    tokio::task::spawn_blocking(move || read_recent(&root, MAX_BYTES, MAX_LINES))
        .await
        .map_err(|error| format!("日志读取任务失败：{error}"))?
}

fn stored_log_files(root: &Path) -> Result<Vec<std::path::PathBuf>, String> {
    let mut files = Vec::new();
    for entry in fs::read_dir(root).map_err(|error| format!("日志目录读取失败：{error}"))?
    {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if (name == "dockmapper.log" || name.starts_with("dockmapper.log."))
            && entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_file()
        {
            files.push(entry.path());
        }
    }
    files.sort();
    Ok(files)
}

fn all_log_text(root: &Path) -> Result<String, String> {
    let mut text = String::new();
    for path in stored_log_files(root)? {
        let bytes = fs::read(path).map_err(|error| format!("日志文件读取失败：{error}"))?;
        text.push_str(&String::from_utf8_lossy(&bytes));
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
    }
    Ok(redact_sensitive_text(&text))
}

fn clear_stored_logs(root: &Path) -> Result<(), String> {
    for path in stored_log_files(root)? {
        // Keep open append handles valid on Windows; subsequent records still append normally.
        fs::OpenOptions::new()
            .write(true)
            .open(path)
            .and_then(|file| file.set_len(0))
            .map_err(|error| format!("日志删除失败：{error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_runtime_log_text(
    diagnostics: State<'_, DiagnosticsState>,
) -> Result<String, String> {
    let root = diagnostics.log_dir.clone();
    let writer = diagnostics.writer.clone();
    tokio::task::spawn_blocking(move || writer.exclusive(|| all_log_text(&root)))
        .await
        .map_err(|error| format!("日志复制读取任务失败：{error}"))?
}

#[tauri::command]
pub async fn clear_runtime_logs(diagnostics: State<'_, DiagnosticsState>) -> Result<(), String> {
    let root = diagnostics.log_dir.clone();
    let writer = diagnostics.writer.clone();
    tokio::task::spawn_blocking(move || writer.exclusive(|| clear_stored_logs(&root)))
        .await
        .map_err(|error| format!("日志删除任务失败：{error}"))?
}
fn frontend_line(level: LogLevel, source: LogSource, message: &str) -> Result<String, String> {
    use std::fmt::Write;
    use tracing_subscriber::fmt::{
        format::Writer,
        time::{FormatTime, SystemTime},
    };
    if message.len() > 2048 {
        return Err("日志消息超过长度限制".into());
    }
    if message.trim().is_empty() {
        return Err("日志内容不能为空".into());
    }
    let message = message
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>();
    let mut line = String::new();
    SystemTime
        .format_time(&mut Writer::new(&mut line))
        .map_err(|_| "日志时间格式化失败")?;
    writeln!(
        &mut line,
        " {} dock_mapper::frontend: source={} {}",
        level.label(),
        source.label(),
        redact_sensitive_text(&message)
    )
    .map_err(|_| "日志格式化失败")?;
    Ok(line)
}
#[tauri::command]
pub async fn append_runtime_log(
    diagnostics: State<'_, DiagnosticsState>,
    level: LogLevel,
    source: LogSource,
    message: String,
) -> Result<(), String> {
    let line = frontend_line(level, source, &message)?;
    let writer = diagnostics.writer.clone();
    tokio::task::spawn_blocking(move || writer.write_line(&line))
        .await
        .map_err(|error| format!("日志写入任务失败：{error}"))?
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "dockmapper-logs-{}-{}",
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
    fn copying_all_logs_includes_records_beyond_the_visible_limit_and_redacts_paths() {
        let root = fixture();
        fs::write(root.join("dockmapper.log.2026-10-17"), "old record\n").unwrap();
        fs::write(
            root.join("dockmapper.log.2026-10-18"),
            format!(
                "{}error C:\\Users\\someone\\private.png\n",
                "new record\n".repeat(600)
            ),
        )
        .unwrap();
        fs::write(root.join("other-app.log"), "unrelated secret").unwrap();
        let text = all_log_text(&root).unwrap();
        assert!(text.starts_with("old record\n"));
        assert_eq!(text.matches("new record").count(), 600);
        assert!(!text.contains("private.png"));
        assert!(!text.contains("unrelated secret"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deleting_all_logs_keeps_unrelated_files_and_allows_the_open_writer_to_continue() {
        use std::io::Write;
        let root = fixture();
        let current = root.join("dockmapper.log.2026-10-18");
        fs::write(&current, "old\n").unwrap();
        fs::write(root.join("dockmapper.log.2026-10-17"), "older\n").unwrap();
        fs::write(root.join("other-app.log"), "keep").unwrap();
        let mut writer = fs::OpenOptions::new().append(true).open(&current).unwrap();
        clear_stored_logs(&root).unwrap();
        assert!(all_log_text(&root).unwrap().is_empty());
        assert_eq!(
            fs::read_to_string(root.join("other-app.log")).unwrap(),
            "keep"
        );
        writer.write_all(b"new\n").unwrap();
        assert_eq!(all_log_text(&root).unwrap(), "new");
        clear_stored_logs(&root).unwrap();
        assert!(all_log_text(&root).unwrap().is_empty());
        drop(writer);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn log_actions_report_an_unreadable_directory_instead_of_claiming_success() {
        let root = fixture();
        let missing = root.join("missing");
        assert!(all_log_text(&missing).is_err());
        assert!(clear_stored_logs(&missing).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn logs_survive_reopening_and_rotate_in_chronological_order_with_limits() {
        let root = fixture();
        fs::write(
            root.join("dockmapper.log.2026-10-16"),
            "2026-10-16T00:00:00Z INFO dock_mapper: old\n",
        )
        .unwrap();
        fs::write(root.join("dockmapper.log.2026-10-17"), "2026-10-17T00:00:00Z WARN dock_mapper: new\n2026-10-17T00:00:01Z ERROR dock_mapper: last\n").unwrap();
        let report = read_recent(&root, 4096, 500).unwrap();
        assert_eq!(report.lines.len(), 3);
        assert_eq!(report.lines[0].message, "old");
        assert_eq!(
            read_recent(&root, 4096, 1).unwrap().lines[0].message,
            "last"
        );
        assert!(read_recent(&root, 4096, 1).unwrap().truncated);
        assert_eq!(
            read_recent(&root, 4096, 500).unwrap().lines[2].message,
            "last"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn partial_utf8_and_unfinished_last_line_are_not_shown() {
        let root = fixture();
        let text = "2026-10-17T00:00:00Z INFO dock_mapper: 中文记录\n2026-10-17T00:00:01Z INFO dock_mapper: complete\nunfinished";
        fs::write(root.join("dockmapper.log.2026-10-17"), text).unwrap();
        let report = read_recent(&root, text.len() - text.find("中文").unwrap() - 1, 500).unwrap();
        assert!(report.truncated);
        assert_eq!(report.lines.len(), 1);
        assert_eq!(report.lines[0].message, "complete");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn empty_logs_and_read_failures_are_different() {
        let root = fixture();
        assert!(read_recent(&root, MAX_BYTES, MAX_LINES)
            .unwrap()
            .lines
            .is_empty());
        fs::remove_dir_all(&root).unwrap();
        assert!(read_recent(&root, MAX_BYTES, MAX_LINES).is_err());
    }
    #[test]
    fn frontend_logs_are_bounded_single_line_and_redact_quoted_and_unc_paths() {
        let line = frontend_line(
            LogLevel::Error,
            LogSource::History,
            "读取失败 path=\"C:\\private\\a.png\" share=\\\\server\\secret\n伪造行",
        )
        .unwrap();
        assert_eq!(line.lines().count(), 1);
        assert!(!line.contains("private") && !line.contains("server"));
        assert!(frontend_line(LogLevel::Info, LogSource::Application, &"x".repeat(2049)).is_err());
        assert!(frontend_line(LogLevel::Info, LogSource::Application, " ").is_err());
    }
    #[test]
    fn snapshot_sorts_timestamps_and_preserves_multiline_error_context() {
        let root = fixture();
        fs::write(root.join("dockmapper.log.2026-10-17"), "2026-10-17T00:00:02Z INFO dock_mapper: later\n2026-10-17T00:00:01Z ERROR dock_mapper::ocr: earlier\ncontinued error detail\n").unwrap();
        let report = read_recent(&root, MAX_BYTES, MAX_LINES).unwrap();
        assert_eq!(report.lines[0].message, "earlier");
        assert_eq!(report.lines[1].message, "continued error detail");
        assert!(matches!(report.lines[1].level, LogLevel::Error));
        assert_eq!(report.lines[1].source, "ocr");
        assert_eq!(report.lines[2].message, "later");
        fs::remove_dir_all(root).unwrap();
    }
}
