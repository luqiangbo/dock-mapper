mod admin;
mod app_commands;
mod app_state;
mod config;
mod config_transaction;
mod diagnostics;
mod dxgi_capture;
mod history;
mod history_commands;
mod image_commands;
mod image_store;
#[cfg(test)]
mod ipc_contract;
mod key_mapping;
mod key_types;
mod key_visualizer;
mod ocr;
mod raw_input;
mod runtime_health;
mod scancode_mapper;
mod screenshot;
mod sys_monitor;
mod taskbar;
mod tray;
mod visualizer_effects;
mod widget;

use std::sync::Arc;
use tauri::Manager;

pub(crate) use app_state::persist;
pub use app_state::AppState;
#[cfg(test)]
use config_transaction::commit_scancode_change_with;
pub(crate) use config_transaction::{commit_scancode_change_at_path, commit_shortcut_change_with};
pub use key_mapping::{ScancodeMapState, ScancodeMapStatus};
pub(crate) use key_types::supported_keys;
pub use key_types::{KeyCode, KeyMapping, SupportedKey};
pub use widget::{MemoryScheme, UsageScheme, WidgetConfig, WidgetMetricConfig, WidgetMetricKind};

const LEGACY_MAIN_WINDOW_WIDTH: f64 = 920.0;
const CURRENT_MAIN_WINDOW_WIDTH: f64 = 1120.0;

fn migrated_main_window_width(width: f64) -> Option<f64> {
    ((width - LEGACY_MAIN_WINDOW_WIDTH).abs() <= 2.0).then_some(CURRENT_MAIN_WINDOW_WIDTH)
}

fn migrate_main_window_width(app: &tauri::App) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let size = window
        .inner_size()
        .map_err(|error| error.to_string())?
        .to_logical::<f64>(scale);
    let Some(width) = migrated_main_window_width(size.width) else {
        return Ok(());
    };
    window
        .set_size(tauri::LogicalSize::new(width, size.height))
        .map_err(|error| format!("迁移主窗口宽度失败：{error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Some(exit_code) = admin::helper_exit_code_from_args(std::env::args()) {
        std::process::exit(exit_code);
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            screenshot::show_main_window(app);
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filter(|label| label == "main")
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .register_uri_scheme_protocol("dockmapper-shot", |_, request| {
            screenshot::serve_capture_uri(request)
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(screenshot::create_state())
        .manage(visualizer_effects::VisualizerEffectsRuntime::default())
        .setup(|app| {
            app.manage(diagnostics::initialize(app.handle())?);
            if let Err(error) = migrate_main_window_width(app) {
                tracing::warn!(target: "dock_mapper::window", %error);
            }
            #[cfg(desktop)]
            tray::setup(app)?;

            let app_data_dir = app.path().app_data_dir()?;
            let config_path = app_data_dir.join("config.json");
            let loaded_config = config::load(&config_path);
            let history = Arc::new(history::HistoryStore::new(app_data_dir.join("history"))?);
            let monitor_interval = loaded_config.widget_config.refresh_interval_secs;
            let state = AppState::new(loaded_config, config_path, history);
            app.manage(state);
            app.manage(key_visualizer::KeyVisualizerRuntime::default());
            app.manage(sys_monitor::SysMonitorControl::new(monitor_interval));
            app.manage(ocr::OcrService::new(app.handle())?);
            if let Err(error) = screenshot::initialize(app.handle()) {
                tracing::error!(target: "dock_mapper::shortcut", %error, "注册截图快捷键失败");
            }

            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let minimize = app_handle
                            .state::<AppState>()
                            .config
                            .lock()
                            .map(|config| config.minimize_to_tray)
                            .unwrap_or(true);
                        if minimize {
                            api.prevent_close();
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                    }
                });
            }

            widget::setup_window(app)?;
            key_visualizer::setup_window(app)?;

            visualizer_effects::initialize(app.handle());
            sys_monitor::start_sys_monitor(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            key_mapping::get_supported_keys,
            key_mapping::get_key_mappings,
            key_mapping::sync_key_mappings,
            key_mapping::get_scancode_map_status,
            key_mapping::apply_scancode_map,
            key_mapping::restore_scancode_map,
            image_commands::upload_image,
            image_commands::release_image,
            history_commands::list_screenshot_history,
            history_commands::get_screenshot_history_image,
            history_commands::get_screenshot_history_thumbnail,
            history_commands::create_screenshot_history,
            history_commands::set_screenshot_history_favorite,
            history_commands::delete_screenshot_history,
            history_commands::copy_screenshot_history,
            history_commands::pin_screenshot_history,
            runtime_health::get_runtime_health,
            screenshot::start_screenshot,
            screenshot::start_quick_ocr,
            screenshot::close_overlay,
            screenshot::show_capture_overlay,
            screenshot::overlay_ready,
            screenshot::get_full_screenshot,
            screenshot::report_capture_rendered,
            screenshot::check_screen_permission,
            screenshot::output::copy_image,
            screenshot::output::copy_text,
            screenshot::output::save_image,
            screenshot::pin_image,
            screenshot::get_pin_image,
            screenshot::pin_image_ready,
            screenshot::get_pin_options,
            screenshot::update_pin_options,
            screenshot::output::copy_pin_image,
            screenshot::output::save_pin_image,
            screenshot::close_pin_window,
            screenshot::get_pin_window_geometry,
            screenshot::set_pin_window_geometry,
            screenshot::open_url,
            app_commands::get_screenshot_config,
            app_commands::update_screenshot_config,
            app_commands::update_screenshot_annotation_color,
            app_commands::update_screenshot_annotation_outline,
            app_commands::update_screenshot_annotation_styles,
            app_commands::get_screenshot_shortcut_statuses,
            app_commands::reset_screenshot_shortcuts,
            app_commands::choose_screenshot_save_directory,
            app_commands::export_diagnostics,
            app_commands::recognize_selection,
            app_commands::get_color_palette,
            app_commands::record_palette_color,
            app_commands::set_palette_favorite,
            app_commands::clear_recent_palette,
            app_commands::decode_qr_selection,
            widget::refresh_widget_position,
            widget::get_widget_config,
            widget::update_widget_config,
            widget::sync_widget_dynamic_width,
            key_visualizer::key_visualizer_ready,
            key_visualizer::get_key_visualizer_session,
            visualizer_effects::get_key_visualizer_effects_status,
            visualizer_effects::locate_key_visualizer_mouse,
            visualizer_effects::key_visualizer_effects_ready,
            key_visualizer::get_key_visualizer_config,
            key_visualizer::update_key_visualizer_config,
            key_visualizer::get_key_visualizer_status,
            key_visualizer::retry_key_visualizer,
            app_commands::get_minimize_to_tray,
            app_commands::set_minimize_to_tray,
        ])
        .build(tauri::generate_context!())
        .expect("构建 DockMapper 失败");

    app.run(|app, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            if let Some(control) = app.try_state::<sys_monitor::SysMonitorControl>() {
                control.shutdown();
            }
            if let Some(runtime) = app.try_state::<key_visualizer::KeyVisualizerRuntime>() {
                runtime.stop();
            }
        }
    });
}

#[cfg(test)]
mod main_window_tests {
    use super::*;

    #[test]
    fn legacy_default_width_migrates_once_without_overriding_user_sizes() {
        assert_eq!(migrated_main_window_width(920.0), Some(1120.0));
        assert_eq!(migrated_main_window_width(921.5), Some(1120.0));
        assert_eq!(migrated_main_window_width(1000.0), None);
        assert_eq!(migrated_main_window_width(1120.0), None);
    }
}

#[cfg(test)]
mod transaction_tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn shortcut_transaction_restores_previous_registration_when_save_fails() {
        let registrations = Mutex::new(Vec::new());
        let config = config::AppConfig::default();
        let previous = config.screenshot_config.clone();
        let next = config::ScreenshotConfig {
            shortcut: "Control+Shift+1".into(),
            history_shortcut: "Control+Shift+3".into(),
            ..previous.clone()
        };
        let result = commit_shortcut_change_with(
            &previous,
            &next,
            &config,
            |from, to| {
                registrations.lock().unwrap().push(format!(
                    "{}+{} -> {}+{}",
                    from.shortcut, from.history_shortcut, to.shortcut, to.history_shortcut
                ));
                Ok(())
            },
            |_| Err("保存失败".into()),
        );
        assert_eq!(result.unwrap_err(), "保存失败");
        assert_eq!(
            *registrations.lock().unwrap(),
            vec![
                "Control+1+Control+3 -> Control+Shift+1+Control+Shift+3",
                "Control+Shift+1+Control+Shift+3 -> Control+1+Control+3"
            ]
        );
    }

    #[test]
    fn shortcut_transaction_does_not_save_after_registration_failure() {
        let registrations = Mutex::new(0_u8);
        let saved = Mutex::new(false);
        let config = config::AppConfig::default();
        let previous = config.screenshot_config.clone();
        let next = config::ScreenshotConfig {
            toggle_pin_shortcut: "Control+Alt+L".into(),
            ..previous.clone()
        };
        let result = commit_shortcut_change_with(
            &previous,
            &next,
            &config,
            |_, _| {
                *registrations.lock().unwrap() += 1;
                Err("快捷键已占用".into())
            },
            |_| {
                *saved.lock().unwrap() = true;
                Ok(())
            },
        );
        assert_eq!(result.unwrap_err(), "快捷键已占用");
        assert_eq!(*registrations.lock().unwrap(), 1);
        assert!(!*saved.lock().unwrap());
    }

    #[test]
    fn shortcut_transaction_does_not_reregister_unchanged_hotkeys() {
        let registrations = Mutex::new(Vec::<String>::new());
        let config = config::AppConfig::default();
        commit_shortcut_change_with(
            &config.screenshot_config,
            &config.screenshot_config,
            &config,
            |_, _| {
                registrations.lock().unwrap().push("changed".into());
                Ok(())
            },
            |_| Ok(()),
        )
        .unwrap();
        assert!(registrations.lock().unwrap().is_empty());
    }

    #[test]
    fn shortcut_transaction_registers_quick_ocr_changes() {
        let registrations = Mutex::new(0_u8);
        let config = config::AppConfig::default();
        let previous = config.screenshot_config.clone();
        let next = config::ScreenshotConfig {
            quick_ocr_shortcut: "Control+Shift+2".into(),
            ..previous.clone()
        };
        commit_shortcut_change_with(
            &previous,
            &next,
            &config,
            |_, _| {
                *registrations.lock().unwrap() += 1;
                Ok(())
            },
            |_| Ok(()),
        )
        .unwrap();
        assert_eq!(*registrations.lock().unwrap(), 1);
    }

    #[test]
    fn scancode_transaction_commits_registry_and_config_once() {
        let writes = Mutex::new(Vec::<Option<Vec<u8>>>::new());
        let saved = Mutex::new(0_u8);
        let config = config::AppConfig::default();
        commit_scancode_change_with(
            None,
            Some(&[3, 4]),
            &config,
            |value| {
                writes.lock().unwrap().push(value.map(<[u8]>::to_vec));
                Ok(())
            },
            |_| {
                *saved.lock().unwrap() += 1;
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(*writes.lock().unwrap(), vec![Some(vec![3, 4])]);
        assert_eq!(*saved.lock().unwrap(), 1);
    }

    #[test]
    fn scancode_transaction_does_not_save_after_registry_write_failure() {
        let saved = Mutex::new(false);
        let config = config::AppConfig::default();
        let result = commit_scancode_change_with(
            None,
            Some(&[3, 4]),
            &config,
            |_| Err("注册表拒绝访问".into()),
            |_| {
                *saved.lock().unwrap() = true;
                Ok(())
            },
        );
        assert_eq!(result.unwrap_err(), "注册表拒绝访问");
        assert!(!*saved.lock().unwrap());
    }

    #[test]
    fn scancode_transaction_rolls_registry_back_when_config_save_fails() {
        let writes = Mutex::new(Vec::<Option<Vec<u8>>>::new());
        let config = config::AppConfig::default();
        let result = commit_scancode_change_with(
            Some(&[1, 2]),
            Some(&[3, 4]),
            &config,
            |value| {
                writes.lock().unwrap().push(value.map(<[u8]>::to_vec));
                Ok(())
            },
            |_| Err("磁盘已满".into()),
        );

        assert_eq!(result.unwrap_err(), "磁盘已满");
        assert_eq!(
            *writes.lock().unwrap(),
            vec![Some(vec![3, 4]), Some(vec![1, 2])]
        );
    }

    #[test]
    fn scancode_transaction_reports_a_failed_rollback() {
        let calls = Mutex::new(0_u8);
        let config = config::AppConfig::default();
        let result = commit_scancode_change_with(
            None,
            Some(&[3, 4]),
            &config,
            |_| {
                let mut calls = calls.lock().unwrap();
                *calls += 1;
                if *calls == 2 {
                    Err("注册表拒绝访问".into())
                } else {
                    Ok(())
                }
            },
            |_| Err("磁盘已满".into()),
        );

        assert_eq!(
            result.unwrap_err(),
            "磁盘已满；同时回滚系统键盘映射失败：注册表拒绝访问"
        );
    }
}
