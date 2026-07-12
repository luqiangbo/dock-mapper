mod admin;
mod config;
mod key_mapper;
mod sys_monitor;
mod taskbar;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

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
    static ref MINIMIZE_TO_TRAY: Mutex<bool> = Mutex::new(true);
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
    persist_config();
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
fn update_widget_config(app: tauri::AppHandle, cfg: WidgetConfig) {
    *WIDGET_CONFIG.lock().unwrap() = cfg.clone();
    let _ = app.emit("scheme-changed", cfg.memory_scheme);
    println!("[config] Updated — scheme={}", cfg.memory_scheme);
    persist_config();
}

/// Tauri command: called by the widget's ResizeObserver whenever its
/// content width changes.
#[tauri::command]
fn sync_widget_dynamic_width(app: tauri::AppHandle, width: f64) {
    taskbar::sync_dynamic_width(&app, width);
}

/// Tauri command: get the minimize-to-tray setting
#[tauri::command]
fn get_minimize_to_tray() -> bool {
    *MINIMIZE_TO_TRAY.lock().unwrap()
}

/// Tauri command: set the minimize-to-tray setting
#[tauri::command]
fn set_minimize_to_tray(enabled: bool) {
    *MINIMIZE_TO_TRAY.lock().unwrap() = enabled;
    println!("[config] Minimize-to-tray: {enabled}");
    persist_config();
}

/// Collect all in-memory state and persist to disk.
fn persist_config() {
    let cfg = config::AppConfig {
        key_mappings: key_mapper::get_mappings(),
        widget_config: WIDGET_CONFIG.lock().unwrap().clone(),
        minimize_to_tray: *MINIMIZE_TO_TRAY.lock().unwrap(),
    };
    config::save(&cfg);
}

// ─── Set up the system tray icon with context menu ───────────────────────
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // ── Menu items ───────────────────────────────────────────────────
    let show = MenuItemBuilder::with_id("show", "显示主窗口").build(app)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let about = MenuItemBuilder::with_id("about", "关于 DockMapper").build(app)?;
    let separator2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&separator)
        .item(&about)
        .item(&separator2)
        .item(&quit)
        .build()?;

    // ── Tray icon ────────────────────────────────────────────────────
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("default window icon must be set in tauri.conf.json");

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("DockMapper — 任务栏工具")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "about" => {
                // Open the main window to the settings page (or just show a simple dialog)
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    println!("[tray] System tray icon created");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(|app| {
            // ── Tray icon ────────────────────────────────────────────
            #[cfg(desktop)]
            setup_tray(app)?;

            // ── Close-to-tray behavior for the main window ──────────
            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if *MINIMIZE_TO_TRAY.lock().unwrap() {
                            api.prevent_close();
                            if let Some(w) = app_handle.get_webview_window("main") {
                                let _ = w.hide();
                            }
                        }
                    }
                });
            }

            // ── Load persisted config ───────────────────────────────
            if let Ok(data_dir) = app.path().app_data_dir() {
                let cfg = config::init(data_dir);
                key_mapper::update_mappings(cfg.key_mappings);
                *WIDGET_CONFIG.lock().unwrap() = cfg.widget_config;
                *MINIMIZE_TO_TRAY.lock().unwrap() = cfg.minimize_to_tray;
                println!("[config] In-memory state restored from disk");
            }

            // ── Widget setup ─────────────────────────────────────────
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
            get_minimize_to_tray,
            set_minimize_to_tray,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
