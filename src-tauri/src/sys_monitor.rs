use std::time::Duration;
use sysinfo::{Networks, System};
use tauri::{self, AppHandle, Emitter, Manager};

#[derive(Clone, serde::Serialize)]
struct SysStatusPayload {
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
            let (upload_speed, download_speed) = if initialized {
                (
                    total_tx.saturating_sub(prev_tx) as f64,
                    total_rx.saturating_sub(prev_rx) as f64,
                )
            } else {
                initialized = true;
                (0.0, 0.0)
            };

            prev_rx = total_rx;
            prev_tx = total_tx;

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

            // Emit the payload exclusively to the taskbar widget window
            if let Some(widget_win) = app_handle.get_webview_window("taskbar_widget") {
                let _ = widget_win.emit("sys-status-update", payload);
            }

            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
}
