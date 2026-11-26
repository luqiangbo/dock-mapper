use crate::screenshot;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TrayAction {
    ShowMain,
    Capture,
    QuickOcr,
    DelayedCapture,
    OpenHistory,
    PinRecent,
    ToggleLatestPin,
    ToggleAllPins,
    RestorePinInteraction,
    CloseAllPins,
    ToggleMapping,
    Quit,
}

fn tray_action(id: &str) -> Option<TrayAction> {
    match id {
        "show" => Some(TrayAction::ShowMain),
        "capture" => Some(TrayAction::Capture),
        "quick_ocr" => Some(TrayAction::QuickOcr),
        "delayed_capture" => Some(TrayAction::DelayedCapture),
        "screenshot_history" => Some(TrayAction::OpenHistory),
        "pin_recent" => Some(TrayAction::PinRecent),
        "toggle_latest_pin" => Some(TrayAction::ToggleLatestPin),
        "toggle_all_pins" => Some(TrayAction::ToggleAllPins),
        "restore_pin_interaction" => Some(TrayAction::RestorePinInteraction),
        "close_all_pins" => Some(TrayAction::CloseAllPins),
        "toggle_mapping" => Some(TrayAction::ToggleMapping),
        "quit" => Some(TrayAction::Quit),
        _ => None,
    }
}

struct MappingMenu(tauri::menu::MenuItem<tauri::Wry>);
pub fn sync_mapping_toggle(app: &tauri::AppHandle, enabled: bool) {
    if let Some(item) = app.try_state::<MappingMenu>() {
        if let Err(error) = item.0.set_text(if enabled {
            "暂停按键映射"
        } else {
            "启用按键映射"
        }) {
            tracing::warn!(%error, "Failed to update key mapping tray action");
        }
    }
}

pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::with_id("show", "显示主窗口").build(app)?;
    let capture = MenuItemBuilder::with_id("capture", "截图").build(app)?;
    let quick_ocr = MenuItemBuilder::with_id("quick_ocr", "快速 OCR").build(app)?;
    let delayed_capture =
        MenuItemBuilder::with_id("delayed_capture", "延时截图（3 秒）").build(app)?;
    let history = MenuItemBuilder::with_id("screenshot_history", "截图历史").build(app)?;
    let pin_separator = PredefinedMenuItem::separator(app)?;
    let pin_recent = MenuItemBuilder::with_id("pin_recent", "贴出最近截图").build(app)?;
    let toggle_pin =
        MenuItemBuilder::with_id("toggle_latest_pin", "显示/隐藏最近贴图").build(app)?;
    let toggle_all_pins =
        MenuItemBuilder::with_id("toggle_all_pins", "全部显隐贴图").build(app)?;
    let restore_pin_interaction =
        MenuItemBuilder::with_id("restore_pin_interaction", "取消贴图穿透").build(app)?;
    let close_all_pins =
        MenuItemBuilder::with_id("close_all_pins", "关闭全部贴图").build(app)?;
    let mapping_separator = PredefinedMenuItem::separator(app)?;
    let mapping = MenuItemBuilder::with_id("toggle_mapping", "暂停按键映射").build(app)?;
    app.manage(MappingMenu(mapping.clone()));
    let quit_separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&capture)
        .item(&quick_ocr)
        .item(&delayed_capture)
        .item(&history)
        .item(&pin_separator)
        .item(&pin_recent)
        .item(&toggle_pin)
        .item(&toggle_all_pins)
        .item(&restore_pin_interaction)
        .item(&close_all_pins)
        .item(&mapping_separator)
        .item(&mapping)
        .item(&quit_separator)
        .item(&quit)
        .build()?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("tauri.conf.json 未配置默认窗口图标")?;

    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("DockMapper — 任务栏工具")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match tray_action(event.id().as_ref()) {
            Some(TrayAction::ShowMain) => screenshot::show_main_window(app),
            Some(TrayAction::Capture) => screenshot::start_capture(app),
            Some(TrayAction::QuickOcr) => screenshot::start_quick_ocr_capture(app),
            Some(TrayAction::DelayedCapture) => screenshot::start_delayed_capture(app, 3_000),
            Some(TrayAction::OpenHistory) => screenshot::open_screenshot_history(app),
            Some(TrayAction::PinRecent) => screenshot::pin_recent_screenshot(app),
            Some(TrayAction::ToggleLatestPin) => screenshot::toggle_latest_pin(app),
            Some(TrayAction::ToggleAllPins) => screenshot::toggle_all_pins(app),
            Some(TrayAction::RestorePinInteraction) => screenshot::disable_all_pin_passthrough(app),
            Some(TrayAction::CloseAllPins) => screenshot::close_all_pins(app),
            Some(TrayAction::ToggleMapping) => {
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let result = (|| {
                        let state = app.try_state::<crate::AppState>().ok_or("应用尚未初始化")?;
                        crate::key_mapping::toggle_from_tray(&app, &state)
                    })();
                    if let Err(error) = result {
                        tracing::error!(%error, "Tray mapping toggle failed");
                        screenshot::show_main_window(&app);
                        if let Err(emit_error) = app.emit("key-mapping-error", error) {
                            tracing::warn!(%emit_error);
                        }
                    }
                });
            }
            Some(TrayAction::Quit) => app.exit(0),
            None => {}
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_all_screenshot_entries_without_an_about_action() {
        assert_eq!(tray_action("show"), Some(TrayAction::ShowMain));
        assert_eq!(tray_action("capture"), Some(TrayAction::Capture));
        assert_eq!(tray_action("quick_ocr"), Some(TrayAction::QuickOcr));
        assert_eq!(
            tray_action("delayed_capture"),
            Some(TrayAction::DelayedCapture)
        );
        assert_eq!(
            tray_action("screenshot_history"),
            Some(TrayAction::OpenHistory)
        );
        assert_eq!(tray_action("pin_recent"), Some(TrayAction::PinRecent));
        assert_eq!(
            tray_action("toggle_latest_pin"),
            Some(TrayAction::ToggleLatestPin)
        );
        assert_eq!(
            tray_action("toggle_all_pins"),
            Some(TrayAction::ToggleAllPins)
        );
        assert_eq!(
            tray_action("restore_pin_interaction"),
            Some(TrayAction::RestorePinInteraction)
        );
        assert_eq!(
            tray_action("close_all_pins"),
            Some(TrayAction::CloseAllPins)
        );
        assert_eq!(tray_action("about"), None);
        assert_eq!(
            tray_action("toggle_mapping"),
            Some(TrayAction::ToggleMapping)
        );
    }
}
