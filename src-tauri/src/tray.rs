use crate::screenshot;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TrayAction {
    ShowMain,
    Capture,
    OpenHistory,
    PinRecent,
    ToggleLatestPin,
    Presentation,
    Quit,
}

fn tray_action(id: &str) -> Option<TrayAction> {
    match id {
        "show" => Some(TrayAction::ShowMain),
        "capture" => Some(TrayAction::Capture),
        "screenshot_history" => Some(TrayAction::OpenHistory),
        "pin_recent" => Some(TrayAction::PinRecent),
        "toggle_latest_pin" => Some(TrayAction::ToggleLatestPin),
        "presentation" => Some(TrayAction::Presentation),
        "quit" => Some(TrayAction::Quit),
        _ => None,
    }
}

pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::with_id("show", "显示主窗口").build(app)?;
    let capture = MenuItemBuilder::with_id("capture", "截图").build(app)?;
    let history = MenuItemBuilder::with_id("screenshot_history", "截图历史").build(app)?;
    let pin_recent = MenuItemBuilder::with_id("pin_recent", "贴出最近截图").build(app)?;
    let toggle_pin =
        MenuItemBuilder::with_id("toggle_latest_pin", "显示/隐藏最近贴图").build(app)?;
    let presentation = MenuItemBuilder::with_id("presentation", "启用演示模式").build(app)?;
    app.manage(PresentationTray(presentation.clone()));
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&capture)
        .item(&history)
        .item(&pin_recent)
        .item(&toggle_pin)
        .item(&presentation)
        .item(&separator)
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
        .on_menu_event(|app, event| match tray_action(event.id().as_ref()) {
            Some(TrayAction::ShowMain) => screenshot::show_main_window(app),
            Some(TrayAction::Capture) => screenshot::start_capture(app),
            Some(TrayAction::OpenHistory) => screenshot::open_screenshot_history(app),
            Some(TrayAction::PinRecent) => screenshot::pin_recent_screenshot(app),
            Some(TrayAction::ToggleLatestPin) => screenshot::toggle_latest_pin(app),
            Some(TrayAction::Presentation) => crate::presentation::dispatch_toggle(app),
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
        assert_eq!(
            tray_action("screenshot_history"),
            Some(TrayAction::OpenHistory)
        );
        assert_eq!(tray_action("pin_recent"), Some(TrayAction::PinRecent));
        assert_eq!(
            tray_action("toggle_latest_pin"),
            Some(TrayAction::ToggleLatestPin)
        );
        assert_eq!(tray_action("about"), None);
    }
}

struct PresentationTray(tauri::menu::MenuItem<tauri::Wry>);
pub fn sync_presentation(app: &tauri::AppHandle, enabled: bool, failed: bool) {
    if let Some(item) = app.try_state::<PresentationTray>() {
        let label = if enabled { "退出演示模式" } else if failed { "重试演示模式" } else { "启用演示模式" };
        if let Err(error) = item.0.set_text(label) { tracing::warn!(%error, "更新演示托盘失败"); }
    }
}
