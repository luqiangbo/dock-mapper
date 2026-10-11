pub use crate::widget_layout::{WidgetLayoutBudget, WidgetLayoutRequest};
use crate::{
    widget_layout::{calculate_layout, LayoutContext, LayoutProbe, LayoutTarget},
    AppState,
};
use std::ffi::CString;
use std::time::Instant;
use tauri::{Emitter, Manager};
use windows::core::{BOOL, PCSTR};
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, FindWindowA, GetClassNameA, GetClientRect, GetParent, GetWindowLongPtrW,
    GetWindowRect, IsWindowVisible, SetParent, SetWindowLongPtrW, SetWindowPos, ShowWindow,
    GWL_EXSTYLE, GWL_STYLE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    SW_HIDE, SW_SHOWNOACTIVATE, WS_BORDER, WS_CAPTION, WS_CHILD, WS_DLGFRAME, WS_EX_CLIENTEDGE,
    WS_EX_DLGMODALFRAME, WS_EX_STATICEDGE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT, WS_EX_WINDOWEDGE,
    WS_POPUP, WS_THICKFRAME, WS_VISIBLE,
};

struct DescendantSearch {
    class_name: &'static [u8],
    excluded: HWND,
    found: Option<HWND>,
}
unsafe extern "system" fn find_descendant_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let search = &mut *(lparam.0 as *mut DescendantSearch);
    if hwnd == search.excluded {
        return BOOL(1);
    }
    let mut name = [0_u8; 128];
    let length = GetClassNameA(hwnd, &mut name);
    if length > 0 && &name[..length as usize] == search.class_name {
        search.found = Some(hwnd);
        return BOOL(0);
    }
    BOOL(1)
}
unsafe fn descendant(host: HWND, class_name: &'static [u8], excluded: HWND) -> Option<HWND> {
    let mut search = DescendantSearch {
        class_name,
        excluded,
        found: None,
    };
    let _ = EnumChildWindows(
        Some(host),
        Some(find_descendant_callback),
        LPARAM((&mut search as *mut DescendantSearch) as isize),
    );
    search.found
}
unsafe fn find_taskbar_hwnd() -> Option<HWND> {
    let class_name = CString::new("Shell_TrayWnd").ok()?;
    FindWindowA(PCSTR(class_name.as_ptr() as *const u8), PCSTR::null())
        .ok()
        .filter(|h| !h.0.is_null())
}
unsafe fn bounds(hwnd: HWND) -> Option<[i32; 4]> {
    let mut r = RECT::default();
    GetWindowRect(hwnd, &mut r).ok()?;
    (r.right > r.left && r.bottom > r.top).then_some([r.left, r.top, r.right, r.bottom])
}
fn rect_matches_target(r: [i32; 4], left: i32, top: i32, width: i32, height: i32) -> bool {
    r[0] == left && r[1] == top && r[2] - r[0] == width && r[3] - r[1] == height
}
fn embedded_window_styles(style: isize, ex_style: isize) -> (isize, isize) {
    let frame = WS_POPUP.0 | WS_CAPTION.0 | WS_BORDER.0 | WS_DLGFRAME.0 | WS_THICKFRAME.0;
    let ex_frame =
        WS_EX_WINDOWEDGE.0 | WS_EX_CLIENTEDGE.0 | WS_EX_DLGMODALFRAME.0 | WS_EX_STATICEDGE.0;
    (
        (style & !(frame as isize)) | WS_CHILD.0 as isize,
        (ex_style & !(ex_frame as isize))
            | WS_EX_TOOLWINDOW.0 as isize
            | WS_EX_TRANSPARENT.0 as isize,
    )
}

unsafe fn embed(widget: HWND, host: HWND) -> Result<(), String> {
    let style = GetWindowLongPtrW(widget, GWL_STYLE);
    let ex_style = GetWindowLongPtrW(widget, GWL_EXSTYLE);
    let (embedded_style, embedded_ex_style) = embedded_window_styles(style, ex_style);
    let styles_changed = style != embedded_style || ex_style != embedded_ex_style;
    let parent_changed = GetParent(widget).ok() != Some(host);
    if styles_changed {
        let _ = SetWindowLongPtrW(widget, GWL_STYLE, embedded_style);
        let _ = SetWindowLongPtrW(widget, GWL_EXSTYLE, embedded_ex_style);
        if GetWindowLongPtrW(widget, GWL_STYLE) != embedded_style
            || GetWindowLongPtrW(widget, GWL_EXSTYLE) != embedded_ex_style
        {
            return Err("挂件无边框样式设置失败".into());
        }
    }
    // SetParent returns the previous parent, which may be null even on success.
    if parent_changed {
        let result = SetParent(widget, Some(host));
        if GetParent(widget).ok() != Some(host) {
            return Err(format!("挂件嵌入任务栏失败：{result:?}"));
        }
    }
    if styles_changed || parent_changed {
        // Style bits alone do not invalidate Windows' cached non-client frame.
        SetWindowPos(
            widget,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER,
        )
        .map_err(|e| format!("挂件边框刷新失败：{e}"))?;
    }
    Ok(())
}
unsafe fn apply(
    hwnd: HWND,
    context: &LayoutContext,
    target: Option<LayoutTarget>,
) -> Result<bool, String> {
    let Some(t) = target else {
        let _ = ShowWindow(hwnd, SW_HIDE);
        if GetWindowLongPtrW(hwnd, GWL_STYLE) & WS_VISIBLE.0 as isize != 0 {
            return Err("挂件隐藏失败".into());
        }
        return Ok(false);
    };
    let scale = context.scale;
    let left = context.bounds[0] + (t.x * scale).round() as i32;
    let top = context.bounds[1] + (t.y * scale).round() as i32;
    let width = (t.width * scale).round() as i32;
    let height = (t.height * scale).round() as i32;
    if !bounds(hwnd).is_some_and(|r| rect_matches_target(r, left, top, width, height)) {
        // Move and resize together in physical child coordinates so expanding
        // at the old position cannot briefly cross the safe slot boundary.
        SetWindowPos(
            hwnd,
            None,
            left - context.bounds[0],
            top - context.bounds[1],
            width,
            height,
            SWP_NOACTIVATE | SWP_NOZORDER,
        )
        .map_err(|e| format!("挂件位置或尺寸调整失败：{e}"))?;
    }
    if !bounds(hwnd).is_some_and(|r| rect_matches_target(r, left, top, width, height)) {
        return Err("挂件位置校验失败，将重试布局".into());
    }
    let mut client = RECT::default();
    GetClientRect(hwnd, &mut client).map_err(|e| format!("挂件可用区域读取失败：{e}"))?;
    if client.right - client.left != width || client.bottom - client.top != height {
        return Err("挂件可用区域与布局尺寸不一致，将重试布局".into());
    }
    if GetWindowLongPtrW(hwnd, GWL_STYLE) & WS_VISIBLE.0 as isize == 0 {
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
    if GetWindowLongPtrW(hwnd, GWL_STYLE) & WS_VISIBLE.0 as isize == 0 {
        return Err("挂件显示失败".into());
    }
    Ok(IsWindowVisible(hwnd).as_bool())
}

/// The only native refresh entry; callers must dispatch to the main event loop.
pub fn refresh_on_main_thread(
    app: &tauri::AppHandle,
    request: Option<WidgetLayoutRequest>,
) -> Result<WidgetLayoutBudget, String> {
    let state = app.state::<AppState>();
    let config = state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏")?
        .widget_config
        .clone();
    let mut controller = state
        .widget_layout
        .lock()
        .map_err(|_| "挂件布局状态已损坏")?;
    if let Some(request) = request {
        controller.request = request.normalized();
    }
    let window = app.get_webview_window("taskbar_widget");
    let hwnd = window
        .as_ref()
        .and_then(|w| w.hwnd().ok())
        .filter(|h| !h.0.is_null());
    let host = unsafe { find_taskbar_hwnd() };
    let taskbar = host.and_then(|h| unsafe { bounds(h) });
    let scale = window
        .as_ref()
        .and_then(|w| w.scale_factor().ok())
        .filter(|s| s.is_finite() && *s > 0.0);
    let context = host
        .zip(taskbar)
        .zip(scale)
        .map(|((host, bounds), scale)| LayoutContext {
            host: host.0 as isize,
            bounds,
            scale,
            request: controller.request,
            presentation: serde_json::to_string(&(
                config.layout,
                &config.metrics,
                config.speed_unit,
            ))
            .unwrap_or_default(),
        });
    let probe = match (host, hwnd, context.as_ref()) {
        (Some(host), Some(hwnd), Some(ctx)) => unsafe {
            let tray = descendant(host, b"TrayNotifyWnd", hwnd).and_then(|h| bounds(h));
            let task_list = descendant(host, b"MSTaskListWClass", hwnd).and_then(|h| bounds(h));
            match tray.zip(task_list) {
                Some((tray, list)) => calculate_layout(
                    ctx.bounds,
                    tray,
                    list,
                    ctx.scale,
                    controller.request,
                    config.layout,
                ),
                None => LayoutProbe::ProbeFailed,
            }
        },
        _ => LayoutProbe::ProbeFailed,
    };
    let target = controller.resolve(context.clone(), probe, Instant::now());
    let operation = match (window.as_ref(), hwnd) {
        (Some(_), Some(hwnd)) => unsafe {
            if let Some(ctx) = context.as_ref() {
                embed(hwnd, HWND(ctx.host as *mut _)).and_then(|()| apply(hwnd, ctx, target))
            } else {
                let _ = ShowWindow(hwnd, SW_HIDE);
                if IsWindowVisible(hwnd).as_bool() {
                    Err("挂件隐藏失败".into())
                } else {
                    Ok(false)
                }
            }
        },
        _ => Err("任务栏挂件窗口不可用".into()),
    };
    if let Err(error) = &operation {
        tracing::warn!(%error, "挂件布局操作失败");
        if let Some(hwnd) = hwnd {
            unsafe {
                let _ = ShowWindow(hwnd, SW_HIDE);
            }
        }
    }
    let snapshot = controller.complete(probe, target, operation);
    if controller.needs_publish(&snapshot) {
        // Broadcast also reaches settings while the widget WebView is throttled.
        match app.emit("widget-layout-budget", &snapshot) {
            Ok(()) => controller.mark_published(&snapshot),
            Err(error) => tracing::warn!(?error, "挂件布局状态发布失败，下次刷新重试"),
        }
    }
    Ok(snapshot)
}

pub fn schedule_refresh(app: &tauri::AppHandle) {
    let handle = app.clone();
    // Tauri dispatches inline on the main thread. Start on the async runtime
    // so window events raised during a move cannot reenter the controller.
    tauri::async_runtime::spawn(async move {
        if let Err(error) = refresh(handle, None).await {
            tracing::error!(%error, "挂件布局刷新失败");
        }
    });
}

pub async fn refresh(
    app: tauri::AppHandle,
    request: Option<WidgetLayoutRequest>,
) -> Result<WidgetLayoutBudget, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(refresh_on_main_thread(&handle, request));
    })
    .map_err(|e| format!("挂件布局刷新调度失败：{e}"))?;
    receiver
        .await
        .map_err(|_| "挂件布局刷新已取消".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn taskbar_widget_starts_without_shadow_insets_that_hide_its_content() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let widget = config["app"]["windows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|window| window["label"] == "taskbar_widget")
            .unwrap();
        // Tao's undecorated shadow adds client insets even after native frame bits are removed.
        assert_eq!(widget["shadow"], false);
        assert_eq!(widget["decorations"], false);
    }
    #[test]
    fn embedded_widget_removes_the_observed_frame_that_clipped_the_last_metric() {
        // Observed live: outer 220px, client 205px; WS_CAPTION and WINDOWEDGE remained.
        let (style, ex_style) = embedded_window_styles(0x54CB0000, 0x000401B8);
        assert_eq!(style & WS_CAPTION.0 as isize, 0);
        assert_eq!(ex_style & WS_EX_WINDOWEDGE.0 as isize, 0);
        assert_ne!(style & WS_CHILD.0 as isize, 0);
        assert_ne!(style & WS_VISIBLE.0 as isize, 0);
        assert_eq!(embedded_window_styles(style, ex_style), (style, ex_style));
    }
    #[test]
    fn reembedding_a_popup_clears_all_non_client_edges_without_losing_transparency() {
        let (style, ex_style) = embedded_window_styles(
            (WS_POPUP.0 | WS_THICKFRAME.0 | WS_CAPTION.0 | WS_VISIBLE.0) as isize,
            (WS_EX_CLIENTEDGE.0 | WS_EX_DLGMODALFRAME.0 | WS_EX_STATICEDGE.0) as isize,
        );
        assert_eq!(
            style & (WS_POPUP.0 | WS_THICKFRAME.0 | WS_CAPTION.0) as isize,
            0
        );
        assert_eq!(
            ex_style & (WS_EX_CLIENTEDGE.0 | WS_EX_DLGMODALFRAME.0 | WS_EX_STATICEDGE.0) as isize,
            0
        );
        assert_ne!(ex_style & WS_EX_TRANSPARENT.0 as isize, 0);
    }
    #[test]
    fn unchanged_native_geometry_does_not_require_another_move() {
        assert!(rect_matches_target([100, 4, 280, 44], 100, 4, 180, 40));
        assert!(!rect_matches_target([100, 4, 280, 44], 103, 4, 180, 40));
    }
}
