//! Read existing local WMI providers; never install/load a hardware driver.
//! Sensor names follow LibreHardwareMonitor's IntelCpu/Amd17Cpu implementation.
use serde::Deserialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone, Default)]
pub struct TemperatureReading {
    pub celsius: Option<f32>,
    pub error: Option<String>,
}

#[derive(Default)]
struct TemperatureState {
    enabled: bool,
    generation: u64,
    probing: bool,
    last_probe: Option<Instant>,
    reading: TemperatureReading,
}

#[derive(Default)]
pub struct CpuTemperatureMonitor {
    state: Arc<Mutex<TemperatureState>>,
}

impl CpuTemperatureMonitor {
    /// Return cached data immediately. A slow/missing provider cannot delay telemetry.
    pub fn sample(&self, enabled: bool) -> TemperatureReading {
        let Ok(mut state) = self.state.lock() else {
            return unavailable("CPU 温度状态不可用");
        };
        if state.enabled != enabled {
            state.enabled = enabled;
            state.generation += 1;
            state.last_probe = None;
            state.reading = if enabled {
                unavailable("正在读取 CPU 温度…")
            } else {
                TemperatureReading::default()
            };
        }
        let interval = if state.reading.celsius.is_some() {
            Duration::from_secs(5)
        } else {
            Duration::from_secs(30)
        };
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
                    // An old query must not populate a disabled/re-enabled metric.
                    if state.generation == generation && state.enabled {
                        state.reading = reading;
                    }
                };
            });
        }
        state.reading.clone()
    }
}

fn unavailable(message: &str) -> TemperatureReading {
    TemperatureReading {
        celsius: None,
        error: Some(message.to_owned()),
    }
}

#[derive(Deserialize)]
struct SensorQuery {
    sensors: Vec<TemperatureSensor>,
    failed: bool,
}

#[derive(Deserialize)]
struct TemperatureSensor {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Parent")]
    parent: String,
    #[serde(rename = "Value")]
    value: Option<f32>,
}

fn select_temperature(sensors: &[TemperatureSensor]) -> Option<f32> {
    let valid = |sensor: &&TemperatureSensor| {
        let cpu = sensor
            .parent
            .strip_prefix("/intelcpu/")
            .or_else(|| sensor.parent.strip_prefix("/amdcpu/"));
        cpu.is_some_and(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()))
            && sensor
                .value
                .is_some_and(|v| v.is_finite() && v > 0.0 && v <= 150.0)
            && !sensor.name.to_ascii_lowercase().contains("distance")
    };
    let candidates: Vec<_> = sensors.iter().filter(valid).collect();
    // Prefer package/die temperature; otherwise report the hottest CPU core.
    let aggregate = candidates.iter().copied().filter(|s| {
        let name = s.name.to_ascii_lowercase();
        name.contains("package")
            || name.contains("tctl")
            || name.contains("tdie")
            || name == "core max"
    });
    aggregate
        .filter_map(|s| s.value)
        .reduce(f32::max)
        .or_else(|| candidates.iter().filter_map(|s| s.value).reduce(f32::max))
}

fn parse_query(bytes: &[u8]) -> TemperatureReading {
    match serde_json::from_slice::<SensorQuery>(bytes) {
        Ok(query) => match select_temperature(&query.sensors) {
            Some(celsius) => TemperatureReading { celsius: Some(celsius), error: None },
            None if query.failed => unavailable("CPU 温度源读取失败，将自动重试"),
            None => unavailable("未检测到温度源，不代表 CPU 不支持测温；请先运行 LibreHardwareMonitor / OpenHardwareMonitor（部分传感器需要管理员权限）"),
        },
        Err(_) => unavailable("CPU 温度源返回了无效数据，将自动重试"),
    }
}

#[cfg(target_os = "windows")]
async fn query() -> TemperatureReading {
    use std::path::PathBuf;
    use std::process::Stdio;
    let root = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("C:\\Windows"));
    let executable = root.join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let mut command = tokio::process::Command::new(executable);
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            include_str!("cpu_temperature.ps1"),
        ])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW: no flashing console.
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    match tokio::time::timeout(Duration::from_secs(5), command.output()).await {
        Ok(Ok(output)) if output.status.success() => parse_query(&output.stdout),
        Err(_) => unavailable("CPU 温度源读取超时，将自动重试"),
        _ => unavailable("CPU 温度源读取失败，将自动重试"),
    }
}

#[cfg(not(target_os = "windows"))]
async fn query() -> TemperatureReading {
    unavailable("当前平台不支持 CPU 温度源")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cpu_package_is_used_instead_of_gpu_or_distance_to_limit() {
        let reading = parse_query(
            br#"{"failed":false,"sensors":[
            {"Name":"GPU Core","Parent":"/nvidiagpu/0","Value":90},
            {"Name":"CPU Core #1","Parent":"/intelcpu/0","Value":80},
            {"Name":"CPU Package","Parent":"/intelcpu/0","Value":72},
            {"Name":"CPU Core #1 Distance to TjMax","Parent":"/intelcpu/0","Value":20}]}"#,
        );
        assert_eq!(reading.celsius, Some(72.0));
        assert!(reading.error.is_none());
    }
    #[test]
    fn missing_or_invalid_sensors_never_become_zero_degrees() {
        for data in [br#"{"failed":false,"sensors":[]}"#.as_slice(), br#"{"failed":false,"sensors":[{"Name":"CPU Package","Parent":"/intelcpu/0","Value":null}]}"#.as_slice(), b"invalid"] {
            let reading = parse_query(data); assert!(reading.celsius.is_none()); assert!(reading.error.is_some());
        }
    }
    #[test]
    fn amd_die_and_core_fallback_return_real_celsius() {
        let amd = parse_query(br#"{"failed":false,"sensors":[{"Name":"Core (Tctl/Tdie)","Parent":"/amdcpu/0","Value":65.5}]}"#);
        assert_eq!(amd.celsius, Some(65.5));
        let cores = parse_query(br#"{"failed":false,"sensors":[{"Name":"CPU Core #1","Parent":"/intelcpu/0","Value":56},{"Name":"CPU Core #2","Parent":"/intelcpu/0","Value":61}]}"#);
        assert_eq!(cores.celsius, Some(61.0));
    }
}
