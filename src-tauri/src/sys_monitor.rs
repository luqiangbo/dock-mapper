use std::time::{Duration, Instant};
use sysinfo::{Networks, System};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::watch;

#[derive(Clone, serde::Serialize)]
pub struct SysStatusPayload {
    upload_speed: f64,
    download_speed: f64,
    memory_usage: f32,
}

#[derive(Clone, Copy)]
struct MonitorSettings {
    interval_secs: u8,
    shutdown: bool,
}

pub struct SysMonitorControl {
    settings: watch::Sender<MonitorSettings>,
}

impl SysMonitorControl {
    pub fn new(interval_secs: u8) -> Self {
        let (settings, _) = watch::channel(MonitorSettings {
            interval_secs: interval_secs.clamp(1, 5),
            shutdown: false,
        });
        Self { settings }
    }

    pub fn set_interval(&self, interval_secs: u8) {
        self.settings.send_modify(|settings| {
            settings.interval_secs = interval_secs.clamp(1, 5);
        });
    }

    pub fn shutdown(&self) {
        self.settings
            .send_modify(|settings| settings.shutdown = true);
    }
}

pub fn start_sys_monitor(app: AppHandle) {
    let mut settings = app.state::<SysMonitorControl>().settings.subscribe();
    tauri::async_runtime::spawn(async move {
        let mut sys = System::new_all();
        let mut networks = Networks::new_with_refreshed_list();
        let mut previous_rx = 0_u64;
        let mut previous_tx = 0_u64;
        let mut initialized = false;
        let mut previous_tick = Instant::now();

        loop {
            let current = *settings.borrow();
            if current.shutdown {
                break;
            }
            networks.refresh();
            sys.refresh_memory();
            let total_rx = networks
                .iter()
                .map(|(_, data)| data.total_received())
                .sum::<u64>();
            let total_tx = networks
                .iter()
                .map(|(_, data)| data.total_transmitted())
                .sum::<u64>();
            let now = Instant::now();
            let elapsed = now.duration_since(previous_tick).as_secs_f64().max(0.001);
            let (upload_speed, download_speed) = if initialized {
                (
                    total_tx.saturating_sub(previous_tx) as f64 / elapsed,
                    total_rx.saturating_sub(previous_rx) as f64 / elapsed,
                )
            } else {
                initialized = true;
                (0.0, 0.0)
            };
            previous_rx = total_rx;
            previous_tx = total_tx;
            previous_tick = now;
            let total_memory = sys.total_memory() as f32;
            let payload = SysStatusPayload {
                upload_speed,
                download_speed,
                memory_usage: if total_memory > 0.0 {
                    sys.used_memory() as f32 / total_memory * 100.0
                } else {
                    0.0
                },
            };

            let widget_visible = emit_if_visible(&app, "taskbar_widget", payload.clone());
            let main_visible = emit_if_visible(&app, "main", payload);
            let interval = if widget_visible || main_visible {
                current.interval_secs.into()
            } else {
                10
            };
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(interval)) => {}
                changed = settings.changed() => {
                    if changed.is_err() { break; }
                }
            }
        }
        tracing::info!(target: "dock_mapper::monitor", "system monitor stopped");
    });
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monitor_interval_is_clamped_and_shutdown_is_observable() {
        let control = SysMonitorControl::new(0);
        assert_eq!(control.settings.borrow().interval_secs, 1);
        control.set_interval(9);
        assert_eq!(control.settings.borrow().interval_secs, 5);
        control.shutdown();
        assert!(control.settings.borrow().shutdown);
    }
}
