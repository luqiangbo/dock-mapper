use std::time::{Duration, Instant};
use sysinfo::{Networks, System};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::watch;

#[derive(Clone, serde::Serialize)]
pub struct SysStatusPayload {
    upload_speed: f64,
    download_speed: f64,
    memory_usage: f32,
    network_available: bool,
}

#[derive(Clone)]
struct MonitorSettings {
    interval_secs: u8,
    shutdown: bool,
    network_interface: Option<String>,
}

pub struct SysMonitorControl {
    settings: watch::Sender<MonitorSettings>,
}

impl SysMonitorControl {
    pub fn new(interval_secs: u8, network_interface: Option<String>) -> Self {
        let (settings, _) = watch::channel(MonitorSettings {
            interval_secs: interval_secs.clamp(1, 5),
            shutdown: false,
            network_interface,
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

    pub fn set_network_interface(&self, network_interface: Option<String>) {
        self.settings.send_modify(|settings| {
            settings.network_interface = network_interface;
        });
    }
}

pub fn start_sys_monitor(app: AppHandle) {
    let mut settings = app.state::<SysMonitorControl>().settings.subscribe();
    tauri::async_runtime::spawn(async move {
        let mut sys = System::new_all();
        let mut networks = Networks::new_with_refreshed_list();
        let mut baseline = NetworkBaseline::default();
        let mut previous_tick = Instant::now();
        let mut last_list_refresh = Instant::now();

        loop {
            let current = settings.borrow().clone();
            if current.shutdown {
                break;
            }
            if last_list_refresh.elapsed() >= Duration::from_secs(30) {
                networks.refresh_list();
                last_list_refresh = Instant::now();
            }
            networks.refresh();
            sys.refresh_memory();
            let selected = current.network_interface.as_deref();
            let network_available = selected.map_or_else(
                || networks.iter().any(|(name, _)| !is_virtual_adapter(name)),
                |value| networks.iter().any(|(name, _)| value == *name),
            );
            let total_rx = networks
                .iter()
                .filter(|(name, _)| selected.map_or_else(|| !is_virtual_adapter(name), |value| value == *name))
                .map(|(_, data)| data.total_received())
                .sum::<u64>();
            let total_tx = networks
                .iter()
                .filter(|(name, _)| selected.map_or_else(|| !is_virtual_adapter(name), |value| value == *name))
                .map(|(_, data)| data.total_transmitted())
                .sum::<u64>();
            let now = Instant::now();
            let elapsed = now.duration_since(previous_tick).as_secs_f64().max(0.001);
            let (upload_speed, download_speed) = baseline.sample(
                current.network_interface.as_deref(),
                network_available,
                total_rx,
                total_tx,
                elapsed,
            );
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
                network_available,
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

#[derive(Default)]
struct NetworkBaseline {
    interface: Option<String>,
    received: u64,
    transmitted: u64,
    initialized: bool,
}

impl NetworkBaseline {
    fn sample(
        &mut self,
        interface: Option<&str>,
        available: bool,
        received: u64,
        transmitted: u64,
        elapsed: f64,
    ) -> (f64, f64) {
        let interface_changed = self.interface.as_deref() != interface;
        if interface_changed {
            self.interface = interface.map(str::to_owned);
            self.initialized = false;
        }
        if !available {
            self.initialized = false;
            self.received = received;
            self.transmitted = transmitted;
            return (0.0, 0.0);
        }
        let rates = if self.initialized {
            let elapsed = elapsed.max(0.001);
            (
                transmitted.saturating_sub(self.transmitted) as f64 / elapsed,
                received.saturating_sub(self.received) as f64 / elapsed,
            )
        } else {
            self.initialized = true;
            (0.0, 0.0)
        };
        self.received = received;
        self.transmitted = transmitted;
        rates
    }
}

fn is_virtual_adapter(name: &str) -> bool {
    let value = name.to_ascii_lowercase();
    ["loopback", "vethernet", "virtual", "vmware", "hyper-v", "wsl", "npcap"]
        .iter()
        .any(|marker| value.contains(marker))
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
        let control = SysMonitorControl::new(0, None);
        assert_eq!(control.settings.borrow().interval_secs, 1);
        control.set_interval(9);
        assert_eq!(control.settings.borrow().interval_secs, 5);
        control.shutdown();
        assert!(control.settings.borrow().shutdown);
    }


    #[test]
    fn changing_or_restoring_an_interface_resets_the_speed_baseline() {
        let mut baseline = NetworkBaseline::default();
        assert_eq!(baseline.sample(Some("Ethernet"), true, 100, 200, 1.0), (0.0, 0.0));
        assert_eq!(baseline.sample(Some("Ethernet"), true, 140, 260, 2.0), (30.0, 20.0));
        assert_eq!(baseline.sample(Some("Wi-Fi"), true, 500, 900, 1.0), (0.0, 0.0));
        assert_eq!(baseline.sample(Some("Wi-Fi"), false, 0, 0, 1.0), (0.0, 0.0));
        assert_eq!(baseline.sample(Some("Wi-Fi"), true, 20, 30, 1.0), (0.0, 0.0));
    }
}
