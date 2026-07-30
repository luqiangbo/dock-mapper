use std::time::{Duration, Instant};
use sysinfo::{Networks, System};
use tauri::{self, AppHandle, Emitter, Manager};

use crate::AppState;

#[derive(Clone, serde::Serialize)]
pub struct SysStatusPayload {
    upload_speed: f64,   // bytes/sec
    download_speed: f64, // bytes/sec
    memory_usage: f32,   // percentage 0.0–100.0
}

/// Starts an async task that periodically collects system stats
/// (network speed, memory usage) and emits them to the `taskbar_widget` window.
pub fn start_sys_monitor(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut sys = System::new_all();
        let mut networks = Networks::new_with_refreshed_list();

        // Previous tick counters for delta calculation
        let mut prev_rx: u64 = 0;
        let mut prev_tx: u64 = 0;
        let mut initialized = false;
        let mut previous_tick = Instant::now();

        loop {
            // Refresh network I/O counters and memory
            networks.refresh();
            sys.refresh_memory();

            let mut total_rx: u64 = 0;
            let mut total_tx: u64 = 0;

            for (_, data) in networks.iter() {
                total_rx += data.total_received();
                total_tx += data.total_transmitted();
            }

            // Calculate delta (bytes per second) since the last tick
            let now = Instant::now();
            let elapsed = now.duration_since(previous_tick).as_secs_f64().max(0.001);
            let (upload_speed, download_speed) = if initialized {
                (
                    total_tx.saturating_sub(prev_tx) as f64 / elapsed,
                    total_rx.saturating_sub(prev_rx) as f64 / elapsed,
                )
            } else {
                initialized = true;
                (0.0, 0.0)
            };

            prev_rx = total_rx;
            prev_tx = total_tx;
            previous_tick = now;

            let total_mem = sys.total_memory() as f32;
            let used_mem = sys.used_memory() as f32;
            let mem_percent = if total_mem > 0.0 {
                (used_mem / total_mem) * 100.0
            } else {
                0.0
            };

            let payload = SysStatusPayload {
                upload_speed,
                download_speed,
                memory_usage: mem_percent,
            };

            let _ = app_handle.emit("sys-status-update", payload);

            let interval = app_handle
                .try_state::<AppState>()
                .and_then(|state| {
                    state
                        .config
                        .lock()
                        .ok()
                        .map(|config| config.widget_config.refresh_interval_secs)
                })
                .unwrap_or(1);
            tokio::time::sleep(Duration::from_secs(interval.into())).await;
        }
    });
}
