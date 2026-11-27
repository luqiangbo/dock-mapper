use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, serde::Serialize)]
pub struct SysStatusPayload {
    upload_speed: f64,
    download_speed: f64,
    memory_usage: f32,
    network_available: bool,
    cpu_usage: Option<f32>,
    battery: Option<BatteryStatus>,
}

#[derive(Clone, serde::Serialize)]
pub struct BatteryStatus {
    percentage: f32,
    charging: bool,
}

#[derive(Clone)]
struct MonitorSettings {
    interval_secs: u8,
    shutdown: bool,
    revision: u64,
}

pub struct SysMonitorControl {
    settings: Arc<(Mutex<MonitorSettings>, Condvar)>,
    pub metrics: crate::sampling_metrics::SamplingMetrics,
}

impl SysMonitorControl {
    pub fn new(interval_secs: u8) -> Self {
        let settings = Arc::new((
            Mutex::new(MonitorSettings {
                interval_secs: interval_secs.clamp(1, 5),
                shutdown: false,
                revision: 0,
            }),
            Condvar::new(),
        ));
        Self {
            settings,
            metrics: crate::sampling_metrics::SamplingMetrics::default(),
        }
    }

    pub fn set_interval(&self, interval_secs: u8) {
        self.update(|settings| settings.interval_secs = interval_secs.clamp(1, 5));
    }

    fn update(&self, update: impl FnOnce(&mut MonitorSettings)) {
        let (settings, wake) = &*self.settings;
        let mut settings = settings.lock().unwrap_or_else(|e| e.into_inner());
        update(&mut settings);
        settings.revision += 1;
        wake.notify_all();
    }

    pub fn wake(&self) {
        self.update(|_| {});
    }

    pub fn shutdown(&self) {
        self.update(|settings| settings.shutdown = true);
    }
}

pub fn start_sys_monitor(app: AppHandle) -> Result<(), String> {
    let mut sys = System::new().map_err(|error| format!("初始化系统采集失败：{error}"))?;
    tracing::info!(target: "dock_mapper::monitor", "system sampling started");
    let settings = app.state::<SysMonitorControl>().settings.clone();
    let metrics = app.state::<SysMonitorControl>().metrics.clone();
    std::thread::Builder::new().name("dockmapper-sampling".into()).spawn(move || {
        let mut cpu_baseline = false;
        let mut networks = crate::network_monitor::NetworkMonitor::default();
        let mut last_resources: Option<Instant> = None;
        let mut memory_usage = 0.0;
        let mut cpu_usage = None;
        let mut battery = None;
        let mut last_visible_main_emit: Option<Instant> = None;
        let mut last_hidden_main_emit: Option<Instant> = None;
        let mut last_network_error = None;
        let mut previously_visible = false;

        loop {
            let current = settings.0.lock().unwrap_or_else(|e| e.into_inner()).clone();
            if current.shutdown {
                break;
            }
            let sample_started = Instant::now();
            let visible = ["main", "taskbar_widget"].iter().any(|label| {
                app.get_webview_window(label).is_some_and(|window| window.is_visible().unwrap_or(false))
            });
            if visible && !previously_visible { networks.reset(); }
            previously_visible = visible;
            let now = Instant::now();
            let (upload_speed, download_speed, network_available) = match networks.sample(now) {
                Ok(value) => { last_network_error = None; value }
                Err(error) => {
                    if last_network_error.as_ref() != Some(&error) {
                        tracing::warn!(target: "dock_mapper::monitor", %error, "网络采样不可用");
                    }
                    last_network_error = Some(error);
                    (0.0, 0.0, false)
                }
            };
            if last_resources.is_none_or(|at| now.duration_since(at) >= Duration::from_secs(current.interval_secs.into())) {
                sys.refresh_memory();
                sys.refresh_cpu_usage();
                let total = sys.total_memory() as f32;
                memory_usage = if total > 0.0 { sys.used_memory() as f32 / total * 100.0 } else { 0.0 };
                cpu_usage = cpu_baseline.then(|| sys.global_cpu_usage());
                cpu_baseline = true;
                battery = battery_status();
                last_resources = Some(now);
            }
            let payload = SysStatusPayload { upload_speed, download_speed, network_available, memory_usage, cpu_usage, battery: battery.clone() };
            let widget_visible = emit_if_visible(&app, "taskbar_widget", payload.clone());
            let main_visible = emit_to_main(
                &app,
                payload,
                now,
                &mut last_visible_main_emit,
                &mut last_hidden_main_emit,
            );
            metrics.record(sample_started.elapsed());
            let interval = if widget_visible {
                Duration::from_millis(500)
            } else if main_visible {
                Duration::from_secs(1)
            } else {
                Duration::from_secs(10)
            };
            let (lock, wake) = &*settings;
            let guard = lock.lock().unwrap_or_else(|e| e.into_inner());
            drop(wake.wait_timeout_while(guard, interval, |value| {
                !value.shutdown && value.revision == current.revision
            }));
        }
        tracing::info!(target: "dock_mapper::monitor", "system monitor stopped");
    }).map_err(|error| format!("创建系统采样线程失败：{error}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn battery_status() -> Option<BatteryStatus> {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut raw = SYSTEM_POWER_STATUS::default();
    if unsafe { GetSystemPowerStatus(&mut raw) }.is_ok() && raw.BatteryLifePercent != u8::MAX {
        Some(BatteryStatus {
            percentage: raw.BatteryLifePercent as f32,
            charging: raw.ACLineStatus == 1,
        })
    } else {
        None
    }
}

#[cfg(not(target_os = "windows"))]
fn battery_status() -> Option<BatteryStatus> {
    None
}

fn emit_if_visible(app: &AppHandle, label: &str, payload: SysStatusPayload) -> bool {
    let Some(window) = app.get_webview_window(label) else {
        return false;
    };
    if !window.is_visible().unwrap_or(false) {
        return false;
    }
    let _ = window.emit("sys-status-update", payload);
    true
}

fn emit_to_main(
    app: &AppHandle,
    payload: SysStatusPayload,
    now: Instant,
    last_visible_emit: &mut Option<Instant>,
    last_hidden_emit: &mut Option<Instant>,
) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    let visible = window.is_visible().unwrap_or(false);
    if should_emit_main_telemetry(visible, *last_visible_emit, *last_hidden_emit, now) {
        if let Err(error) = window.emit("sys-status-update", payload) {
            tracing::warn!(target: "dock_mapper::monitor", %error, "main window telemetry delivery failed");
        }
        if visible {
            *last_visible_emit = Some(now);
        } else {
            *last_hidden_emit = Some(now);
        }
    }
    visible
}

fn should_emit_main_telemetry(
    visible: bool,
    last_visible_emit: Option<Instant>,
    last_hidden_emit: Option<Instant>,
    now: Instant,
) -> bool {
    if visible {
        last_visible_emit.is_none_or(|last| now.duration_since(last) >= Duration::from_secs(1))
    } else {
        last_hidden_emit.is_none_or(|last| now.duration_since(last) >= Duration::from_secs(10))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shutdown_wakes_a_hidden_monitor_without_waiting_for_its_sampling_interval() {
        let control = SysMonitorControl::new(1);
        let settings = control.settings.clone();
        let (ready, waiting) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let (lock, wake) = &*settings;
            let guard = lock.lock().unwrap();
            ready.send(()).unwrap();
            let (guard, timeout) = wake
                .wait_timeout_while(guard, Duration::from_secs(10), |value| !value.shutdown)
                .unwrap();
            assert!(!timeout.timed_out());
            assert!(guard.shutdown);
        });
        waiting.recv_timeout(Duration::from_secs(1)).unwrap();
        control.shutdown();
        worker.join().unwrap();
    }

    #[test]
    fn hidden_main_keeps_collecting_samples_at_low_frequency() {
        let now = Instant::now();
        assert!(should_emit_main_telemetry(false, None, None, now));
        assert!(!should_emit_main_telemetry(
            false,
            None,
            Some(now),
            now + Duration::from_secs(9)
        ));
        assert!(should_emit_main_telemetry(
            false,
            None,
            Some(now),
            now + Duration::from_secs(10)
        ));
        assert!(should_emit_main_telemetry(true, None, Some(now), now));
        assert!(!should_emit_main_telemetry(
            true,
            Some(now),
            Some(now),
            now + Duration::from_millis(500)
        ));
        assert!(should_emit_main_telemetry(
            true,
            Some(now),
            Some(now),
            now + Duration::from_secs(1)
        ));
    }

    #[test]
    fn monitor_interval_is_clamped_and_shutdown_is_observable() {
        let control = SysMonitorControl::new(0);
        assert_eq!(control.settings.0.lock().unwrap().interval_secs, 1);
        control.set_interval(9);
        assert_eq!(control.settings.0.lock().unwrap().interval_secs, 5);
        control.shutdown();
        assert!(control.settings.0.lock().unwrap().shutdown);
    }
}
