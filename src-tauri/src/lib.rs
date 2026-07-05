mod admin;
mod key_mapper;
mod sys_monitor;
mod taskbar;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyMapping {
    pub id: String,
    pub source_key: String,
    pub target_key: String,
    pub enabled: bool,
}

/// Widget live-config pushed from the main config page.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetConfig {
    /// 1 = Capsule Indicator, 2 = Ring & Core, 3 = Dashboard Gauge
    pub memory_scheme: i32,
}

use lazy_static::lazy_static;
use std::sync::Mutex;

lazy_static! {
    static ref WIDGET_CONFIG: Mutex<WidgetConfig> = Mutex::new(WidgetConfig { memory_scheme: 1 });
}

/// Tauri command: get current key mappings
#[tauri::command]
fn get_key_mappings() -> Vec<KeyMapping> {
    key_mapper::get_mappings()
}

/// Tauri command: sync key mappings from frontend
#[tauri::command]
fn sync_key_mappings(mappings: Vec<KeyMapping>) {
    key_mapper::update_mappings(mappings);
}

/// Tauri command: dynamically reposition the taskbar widget
#[tauri::command]
fn refresh_widget_position(app: tauri::AppHandle) {
    taskbar::refresh_widget_position(&app);
}

/// Tauri command: check administrator privilege
#[tauri::command]
fn check_is_admin() -> bool {
    admin::is_elevated()
}

/// Tauri command: relaunch with UAC prompt
#[tauri::command]
fn relaunch_as_admin() {
    admin::relaunch_as_admin();
}

/// Tauri command: return the current widget config (called on widget mount)
#[tauri::command]
fn get_widget_config() -> WidgetConfig {
    WIDGET_CONFIG.lock().unwrap().clone()
}

/// Tauri command: update widget config in real-time.
#[tauri::command]
fn update_widget_config(app: tauri::AppHandle, config: WidgetConfig) {
    *WIDGET_CONFIG.lock().unwrap() = config.clone();
    let _ = app.emit("scheme-changed", config.memory_scheme);
    println!("[config] Updated — scheme={}", config.memory_scheme);
}

/// Tauri command: called by the widget's ResizeObserver whenever its
/// content width changes.
#[tauri::command]
fn sync_widget_dynamic_width(app: tauri::AppHandle, width: f64) {
    taskbar::sync_dynamic_width(&app, width);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let widget_window = app
                .get_webview_window("taskbar_widget")
                .expect("taskbar_widget window should exist from config");

            #[cfg(target_os = "windows")]
            taskbar::embed_widget_to_taskbar(&widget_window);

            sys_monitor::start_sys_monitor(app.handle().clone());
            key_mapper::start_key_mapper();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_key_mappings,
            sync_key_mappings,
            refresh_widget_position,
            check_is_admin,
            relaunch_as_admin,
            get_widget_config,
            update_widget_config,
            sync_widget_dynamic_width,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
