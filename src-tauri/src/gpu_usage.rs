//! Read Windows' GPU engine counters without installing a hardware sensor tool.
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone, Default)]
pub struct GpuReading {
    pub usage: Option<f32>,
    pub error: Option<String>,
}

#[derive(Default)]
struct GpuState {
    enabled: bool,
    generation: u64,
    probing: bool,
    last_probe: Option<Instant>,
    reading: GpuReading,
}

#[derive(Default)]
pub struct GpuUsageMonitor {
    state: Arc<Mutex<GpuState>>,
}

impl GpuUsageMonitor {
    pub fn sample(&self, enabled: bool) -> GpuReading {
        let Ok(mut state) = self.state.lock() else {
            return unavailable("GPU 采样状态不可用");
        };
        if state.enabled != enabled {
            state.enabled = enabled;
            state.generation += 1;
            state.last_probe = None;
            state.reading = if enabled {
                unavailable("正在读取 GPU 占用率…")
            } else {
                GpuReading::default()
            };
        }
        let interval = Duration::from_secs(if state.reading.usage.is_some() { 2 } else { 30 });
        if enabled
            && !state.probing
            && state
                .last_probe
                .is_none_or(|last| last.elapsed() >= interval)
        {
            state.probing = true;
            state.last_probe = Some(Instant::now());
            let generation = state.generation;
            let shared = self.state.clone();
            tauri::async_runtime::spawn(async move {
                let reading = query().await;
                if let Ok(mut state) = shared.lock() {
                    state.probing = false;
                    if state.generation == generation && state.enabled {
                        state.reading = reading;
                    }
                };
            });
        }
        state.reading.clone()
    }
}

fn unavailable(message: &str) -> GpuReading {
    GpuReading {
        usage: None,
        error: Some(message.into()),
    }
}

#[derive(Deserialize)]
struct Engine {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "UtilizationPercentage")]
    usage: Option<f64>,
}

// Sum processes using the same physical GPU engine, then take the busiest
// engine across adapters. Summing different engines would overstate utilization.
fn busiest_engine(engines: &[Engine]) -> Option<f32> {
    let mut totals = HashMap::<&str, f64>::new();
    for engine in engines {
        let Some(value) = engine.usage.filter(|v| v.is_finite() && *v >= 0.0) else {
            continue;
        };
        let Some((process, key)) = engine.name.split_once("_luid_") else {
            continue;
        };
        if !process.starts_with("pid_") || !key.contains("_phys_") || !key.contains("_eng_") {
            continue;
        }
        *totals.entry(key).or_default() += value;
    }
    totals
        .values()
        .copied()
        .reduce(f64::max)
        .map(|v| v.clamp(0.0, 100.0) as f32)
}

#[derive(Deserialize)]
struct CounterQuery {
    engines: Vec<Engine>,
    failed: bool,
}

fn parse_query(bytes: &[u8]) -> GpuReading {
    match serde_json::from_slice::<CounterQuery>(bytes) {
        Ok(query) => match busiest_engine(&query.engines) {
            Some(usage) => GpuReading {
                usage: Some(usage),
                error: None,
            },
            None if query.failed => unavailable("GPU 性能计数器读取失败，将自动重试"),
            None => unavailable("未检测到 GPU 性能计数器；当前显卡驱动可能不提供占用率数据"),
        },
        Err(_) => unavailable("GPU 性能计数器返回无效数据，将自动重试"),
    }
}

#[cfg(target_os = "windows")]
async fn query() -> GpuReading {
    use std::path::PathBuf;
    use std::process::Stdio;
    let root = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("C:\\Windows"));
    let mut command =
        tokio::process::Command::new(root.join("System32/WindowsPowerShell/v1.0/powershell.exe"));
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            include_str!("gpu_usage.ps1"),
        ])
        .creation_flags(0x08000000)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    match tokio::time::timeout(Duration::from_secs(5), command.output()).await {
        Ok(Ok(output)) if output.status.success() => parse_query(&output.stdout),
        Err(_) => unavailable("GPU 性能计数器读取超时，将自动重试"),
        _ => unavailable("GPU 性能计数器读取失败，将自动重试"),
    }
}

#[cfg(not(target_os = "windows"))]
async fn query() -> GpuReading {
    unavailable("当前系统不支持 Windows GPU 性能计数器")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn engine(pid: u32, adapter: u32, index: u32, usage: f64) -> Engine {
        Engine {
            name: format!("pid_{pid}_luid_0x0_0x{adapter}_phys_0_eng_{index}_engtype_3D"),
            usage: Some(usage),
        }
    }
    #[test]
    fn gpu_usage_sums_processes_per_engine_without_summing_engines_or_adapters() {
        assert_eq!(
            busiest_engine(&[
                engine(1, 1, 0, 30.0),
                engine(2, 1, 0, 40.0),
                engine(1, 1, 1, 60.0),
                engine(3, 2, 0, 50.0)
            ]),
            Some(70.0)
        );
        assert_eq!(busiest_engine(&[engine(1, 1, 0, 0.0)]), Some(0.0));
        assert_eq!(
            busiest_engine(&[engine(1, 1, 0, 80.0), engine(2, 1, 0, 50.0)]),
            Some(100.0)
        );
    }
    #[test]
    fn unavailable_or_malformed_gpu_counters_never_report_a_fake_zero() {
        for bytes in [
            br#"{"engines":[],"failed":false}"#.as_slice(),
            br#"{"engines":[],"failed":true}"#.as_slice(),
            b"invalid".as_slice(),
        ] {
            let reading = parse_query(bytes);
            assert!(reading.usage.is_none());
            assert!(reading.error.is_some());
        }
        assert_eq!(
            busiest_engine(&[engine(1, 1, 0, f64::NAN), engine(2, 1, 0, -1.0)]),
            None
        );
    }
}
