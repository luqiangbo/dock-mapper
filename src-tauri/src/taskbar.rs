use std::ffi::CString;
use tauri::{LogicalPosition, LogicalSize, Manager, Position, Size, WebviewWindow};
use windows::core::PCSTR;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowA, FindWindowExA, GetParent, GetSystemMetrics, GetWindowLongPtrW, GetWindowRect,
    SetParent, SetWindowLongPtrW, GWL_EXSTYLE, GWL_STYLE, SM_CXSCREEN, WS_CHILD, WS_EX_TOOLWINDOW,
    WS_EX_TRANSPARENT,
};

// ─── Constants (logical pixels) ─────────────────────────────────────────
const WIDGET_HEIGHT_LOGICAL: f64 = 40.0;
const PADDING_LOGICAL: f64 = 10.0;

/// Initial default width used before the frontend reports its real size.
const DEFAULT_WIDTH_LOGICAL: f64 = 180.0;

/// Embeds the widget webview window into the Windows taskbar.
pub fn embed_widget_to_taskbar(window: &WebviewWindow) {
    let span = tracing::info_span!(target: "dock_mapper::taskbar", "embed_widget");
    let _entered = span.enter();
    let window_hwnd = match window.hwnd() {
        Ok(h) => h,
        Err(e) => {
            tracing::error!(target: "dock_mapper::taskbar", error = ?e, "Could not get widget HWND");
            return;
        }
    };

    if window_hwnd.0.is_null() {
        tracing::error!(target: "dock_mapper::taskbar", "Widget HWND is null");
        return;
    }

    unsafe {
        let class_name = match CString::new("Shell_TrayWnd") {
            Ok(c) => c,
            Err(e) => {
                tracing::error!(target: "dock_mapper::taskbar", %e, "CString error");
                return;
            }
        };

        let taskbar_hwnd = match FindWindowA(PCSTR(class_name.as_ptr() as *const u8), PCSTR::null())
        {
            Ok(h) => h,
            Err(_) => {
                tracing::warn!(target: "dock_mapper::taskbar", "Could not find Shell_TrayWnd");
                return;
            }
        };

        if taskbar_hwnd.0.is_null() {
            tracing::warn!(target: "dock_mapper::taskbar", "Shell_TrayWnd handle is null");
            return;
        }

        // Window styles
        let current_style = GetWindowLongPtrW(window_hwnd, GWL_STYLE);
        let _ = SetWindowLongPtrW(window_hwnd, GWL_STYLE, current_style | WS_CHILD.0 as isize);
        let current_ex_style = GetWindowLongPtrW(window_hwnd, GWL_EXSTYLE);
        let _ = SetWindowLongPtrW(
            window_hwnd,
            GWL_EXSTYLE,
            current_ex_style | WS_EX_TOOLWINDOW.0 as isize | WS_EX_TRANSPARENT.0 as isize,
        );

        // Reparent
        let _ = SetParent(window_hwnd, Some(taskbar_hwnd));

        // Initial size + position
        let _ = window.set_size(Size::Logical(LogicalSize::new(
            DEFAULT_WIDTH_LOGICAL,
            WIDGET_HEIGHT_LOGICAL,
        )));
        position_widget_dpi_aware(window, taskbar_hwnd, DEFAULT_WIDTH_LOGICAL);

        tracing::info!(target: "dock_mapper::taskbar", "Widget embedded successfully");
    }
}

// ─── Helper: find TrayNotifyWnd ─────────────────────────────────────────
unsafe fn find_tray_notify_hwnd(taskbar_hwnd: HWND) -> Option<HWND> {
    let tray_class = CString::new("TrayNotifyWnd").ok()?;
    let result = FindWindowExA(
        Some(taskbar_hwnd),
        None,
        PCSTR(tray_class.as_ptr() as *const u8),
        PCSTR::null(),
    );
    result.ok().filter(|h| !h.0.is_null())
}

unsafe fn get_window_rect(hwnd: HWND) -> Option<RECT> {
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    GetWindowRect(hwnd, &mut rect).ok()?;
    Some(rect)
}

fn needs_reembed(current_parent: Option<HWND>, taskbar_hwnd: HWND) -> bool {
    current_parent != Some(taskbar_hwnd)
}

// ─── DPI-aware position (uses dynamic width from global store) ──────────
unsafe fn position_widget_dpi_aware(
    window: &WebviewWindow,
    taskbar_hwnd: HWND,
    width_logical: f64,
) {
    let scale_factor = window.scale_factor().unwrap_or(1.0);

    let taskbar_rect = match get_window_rect(taskbar_hwnd) {
        Some(r) => r,
        None => return,
    };
    let taskbar_height_physical = (taskbar_rect.bottom - taskbar_rect.top) as f64;
    let taskbar_height_logical = taskbar_height_physical / scale_factor;
    let y_logical = ((taskbar_height_logical - WIDGET_HEIGHT_LOGICAL) / 2.0).max(0.0);

    let x_logical: f64 = match find_tray_notify_hwnd(taskbar_hwnd) {
        Some(tray_hwnd) => {
            if let Some(tray_rect) = get_window_rect(tray_hwnd) {
                let tray_left_physical = (tray_rect.left - taskbar_rect.left) as f64;
                let tray_left_logical = tray_left_physical / scale_factor;
                (tray_left_logical - width_logical - PADDING_LOGICAL).max(0.0)
            } else {
                let screen_width = GetSystemMetrics(SM_CXSCREEN) as f64 / scale_factor;
                screen_width - width_logical - 250.0
            }
        }
        None => {
            let screen_width = GetSystemMetrics(SM_CXSCREEN) as f64 / scale_factor;
            screen_width - width_logical - 250.0
        }
    };

    let _ = window.set_position(Position::Logical(LogicalPosition::new(
        x_logical, y_logical,
    )));

    tracing::debug!(
        target: "dock_mapper::taskbar",
        x_logical,
        y_logical,
        width_logical,
        scale_factor,
        "Widget position refreshed"
    );
}

// ─── Public API ─────────────────────────────────────────────────────────

/// Called by the frontend whenever its content DOM width changes.
/// Resizes the window to exactly match the content width and
/// re-anchors the X position.
pub fn sync_dynamic_width(app: &tauri::AppHandle, width: f64) -> f64 {
    let clamped = if width.is_finite() {
        width.clamp(80.0, 600.0)
    } else {
        DEFAULT_WIDTH_LOGICAL
    };

    if let Some(widget) = app.get_webview_window("taskbar_widget") {
        // 1. Resize to exact content width
        let _ = widget.set_size(Size::Logical(LogicalSize::new(
            clamped,
            WIDGET_HEIGHT_LOGICAL,
        )));

        // 2. Re-anchor X position
        unsafe {
            let class_name = match CString::new("Shell_TrayWnd") {
                Ok(c) => c,
                Err(_) => return clamped,
            };
            if let Ok(taskbar_hwnd) =
                FindWindowA(PCSTR(class_name.as_ptr() as *const u8), PCSTR::null())
            {
                if !taskbar_hwnd.0.is_null() {
                    position_widget_dpi_aware(&widget, taskbar_hwnd, clamped);
                }
            }
        }
    }
    clamped
}

/// Low-frequency recovery refresh, including Explorer/taskbar restarts.
pub fn refresh_widget_position(app: &tauri::AppHandle, width: f64) {
    let span = tracing::debug_span!(target: "dock_mapper::taskbar", "refresh_widget", width);
    let _entered = span.enter();
    if let Some(widget) = app.get_webview_window("taskbar_widget") {
        unsafe {
            let class_name = match CString::new("Shell_TrayWnd") {
                Ok(c) => c,
                Err(_) => return,
            };
            if let Ok(taskbar_hwnd) =
                FindWindowA(PCSTR(class_name.as_ptr() as *const u8), PCSTR::null())
            {
                if !taskbar_hwnd.0.is_null() {
                    if let Ok(widget_hwnd) = widget.hwnd() {
                        let current_parent = GetParent(widget_hwnd).ok();
                        if needs_reembed(current_parent, taskbar_hwnd) {
                            let style = GetWindowLongPtrW(widget_hwnd, GWL_STYLE);
                            let _ = SetWindowLongPtrW(
                                widget_hwnd,
                                GWL_STYLE,
                                style | WS_CHILD.0 as isize,
                            );
                            let ex_style = GetWindowLongPtrW(widget_hwnd, GWL_EXSTYLE);
                            let _ = SetWindowLongPtrW(
                                widget_hwnd,
                                GWL_EXSTYLE,
                                ex_style
                                    | WS_EX_TOOLWINDOW.0 as isize
                                    | WS_EX_TRANSPARENT.0 as isize,
                            );
                            let _ = SetParent(widget_hwnd, Some(taskbar_hwnd));
                        }
                    }
                    position_widget_dpi_aware(&widget, taskbar_hwnd, width);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explorer_parent_change_requires_widget_reembed() {
        let taskbar = HWND(1_usize as *mut _);
        let previous_taskbar = HWND(2_usize as *mut _);
        assert!(!needs_reembed(Some(taskbar), taskbar));
        assert!(needs_reembed(Some(previous_taskbar), taskbar));
        assert!(needs_reembed(None, taskbar));
    }
}
