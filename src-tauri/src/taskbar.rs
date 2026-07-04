use std::ffi::CString;
use tauri::{LogicalPosition, LogicalSize, Manager, Position, Size, WebviewWindow};
use windows::core::PCSTR;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowA, FindWindowExA, GetSystemMetrics, GetWindowLongPtrW, GetWindowRect, SetParent,
    SetWindowLongPtrW, GWL_EXSTYLE, GWL_STYLE, SM_CXSCREEN, WS_CHILD, WS_EX_TOOLWINDOW,
    WS_EX_TRANSPARENT,
};

// ─── Constants (logical pixels) ─────────────────────────────────────────
const WIDGET_HEIGHT_LOGICAL: f64 = 40.0;
const PADDING_LOGICAL: f64 = 10.0;

/// Initial default width used before the frontend reports its real size.
const DEFAULT_WIDTH_LOGICAL: f64 = 180.0;

// ─── Global: latest content-driven width ────────────────────────────────
use lazy_static::lazy_static;
use std::sync::Mutex;

lazy_static! {
    static ref DYNAMIC_WIDTH: Mutex<f64> = Mutex::new(DEFAULT_WIDTH_LOGICAL);
}

/// Embeds the widget webview window into the Windows taskbar.
pub fn embed_widget_to_taskbar(window: &WebviewWindow) {
    let window_hwnd = match window.hwnd() {
        Ok(h) => h,
        Err(e) => {
            eprintln!("[taskbar] Could not get widget HWND: {e:?}");
            return;
        }
    };

    if window_hwnd.0.is_null() {
        eprintln!("[taskbar] Widget HWND is null");
        return;
    }

    unsafe {
        let class_name = match CString::new("Shell_TrayWnd") {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[taskbar] CString error: {e}");
                return;
            }
        };

        let taskbar_hwnd = match FindWindowA(PCSTR(class_name.as_ptr() as *const u8), PCSTR::null())
        {
            Ok(h) => h,
            Err(_) => {
                eprintln!("[taskbar] Could not find Shell_TrayWnd");
                return;
            }
        };

        if taskbar_hwnd.0.is_null() {
            eprintln!("[taskbar] Shell_TrayWnd handle is null");
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
        position_widget_dpi_aware(window, taskbar_hwnd);

        println!("[taskbar] Widget embedded successfully");
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

// ─── DPI-aware position (uses dynamic width from global store) ──────────
unsafe fn position_widget_dpi_aware(window: &WebviewWindow, taskbar_hwnd: HWND) {
    let width_logical = *DYNAMIC_WIDTH.lock().unwrap();

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

    println!(
        "[taskbar] DPI position: logical({x_logical:.1}, {y_logical:.1}), width={width_logical:.0}, scale={scale_factor}"
    );
}

// ─── Public API ─────────────────────────────────────────────────────────

/// Called by the frontend whenever its content DOM width changes.
/// Resizes the window to exactly match the content width and
/// re-anchors the X position.
pub fn sync_dynamic_width(app: &tauri::AppHandle, width: f64) {
    let clamped = width.max(80.0).min(600.0);
    *DYNAMIC_WIDTH.lock().unwrap() = clamped;

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
                Err(_) => return,
            };
            if let Ok(taskbar_hwnd) =
                FindWindowA(PCSTR(class_name.as_ptr() as *const u8), PCSTR::null())
            {
                if !taskbar_hwnd.0.is_null() {
                    position_widget_dpi_aware(&widget, taskbar_hwnd);
                }
            }
        }
    }
}

/// Periodic refresh (used by the 3-second timer).
pub fn refresh_widget_position(app: &tauri::AppHandle) {
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
                    position_widget_dpi_aware(&widget, taskbar_hwnd);
                }
            }
        }
    }
}
