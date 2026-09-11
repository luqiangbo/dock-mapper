use serde::Serialize;
use std::ffi::CString;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{LogicalPosition, LogicalSize, Manager, Position, Size, WebviewWindow};
use windows::core::{BOOL, PCSTR};
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, FindWindowA, GetClassNameA, GetParent, GetWindowLongPtrW, GetWindowRect,
    SetParent, SetWindowLongPtrW, ShowWindow, GWL_EXSTYLE, GWL_STYLE, SW_HIDE, SW_SHOWNOACTIVATE,
    WS_CHILD, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
};

const WIDGET_HEIGHT_LOGICAL: f64 = 40.0;
const PADDING_LOGICAL: f64 = 10.0;
const MIN_WIDTH_LOGICAL: f64 = 48.0;
const MAX_WIDTH_LOGICAL: f64 = 600.0;
const DEFAULT_WIDTH_LOGICAL: f64 = 180.0;
static SAFE_LAYOUT_UNAVAILABLE: AtomicBool = AtomicBool::new(false);

fn record_layout_unavailable(reason: &'static str) {
    if !SAFE_LAYOUT_UNAVAILABLE.swap(true, Ordering::Relaxed) {
        tracing::warn!(target: "dock_mapper::taskbar", reason, "Taskbar widget hidden");
    }
}

fn record_layout_available() {
    if SAFE_LAYOUT_UNAVAILABLE.swap(false, Ordering::Relaxed) {
        tracing::info!(target: "dock_mapper::taskbar", "Taskbar widget safe slot recovered");
    }
}

#[derive(Debug, Clone, Copy)]
pub struct WidgetLayoutRequest {
    pub preferred_width: f64,
    pub minimum_width: f64,
}

impl Default for WidgetLayoutRequest {
    fn default() -> Self {
        Self {
            preferred_width: DEFAULT_WIDTH_LOGICAL,
            minimum_width: MIN_WIDTH_LOGICAL,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetLayoutBudget {
    pub allocated_width: f64,
    pub constrained: bool,
    pub visible: bool,
}

impl WidgetLayoutBudget {
    fn hidden() -> Self {
        Self {
            allocated_width: 0.0,
            constrained: true,
            visible: false,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct WidgetLayoutTarget {
    budget: WidgetLayoutBudget,
    x_logical: f64,
    y_logical: f64,
}

fn normalize_layout_request(request: WidgetLayoutRequest) -> WidgetLayoutRequest {
    let preferred = if request.preferred_width.is_finite() {
        request
            .preferred_width
            .clamp(MIN_WIDTH_LOGICAL, MAX_WIDTH_LOGICAL)
    } else {
        DEFAULT_WIDTH_LOGICAL
    };
    let minimum = if request.minimum_width.is_finite() {
        request.minimum_width.clamp(MIN_WIDTH_LOGICAL, preferred)
    } else {
        MIN_WIDTH_LOGICAL.min(preferred)
    };
    WidgetLayoutRequest {
        preferred_width: preferred,
        minimum_width: minimum,
    }
}

fn calculate_widget_layout(
    taskbar: RECT,
    tray: RECT,
    task_list: RECT,
    scale_factor: f64,
    request: WidgetLayoutRequest,
) -> Option<WidgetLayoutTarget> {
    let scale = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    let request = normalize_layout_request(request);
    let padding_physical = (PADDING_LOGICAL * scale).round() as i32;
    let safe_left = task_list.right.max(taskbar.left) + padding_physical;
    let safe_right = tray.left.min(taskbar.right) - padding_physical;
    let available = ((safe_right - safe_left).max(0) as f64) / scale;
    if available + 0.5 < request.minimum_width {
        return None;
    }
    let allocated_width = request.preferred_width.min(available);
    let taskbar_height = (taskbar.bottom - taskbar.top).max(0) as f64 / scale;
    Some(WidgetLayoutTarget {
        budget: WidgetLayoutBudget {
            allocated_width,
            constrained: allocated_width + 0.5 < request.preferred_width,
            visible: true,
        },
        x_logical: ((safe_right - taskbar.left) as f64 / scale - allocated_width).max(0.0),
        y_logical: ((taskbar_height - WIDGET_HEIGHT_LOGICAL) / 2.0).max(0.0),
    })
}

struct DescendantSearch {
    class_name: &'static [u8],
    excluded: Option<HWND>,
    found: Option<HWND>,
}

unsafe extern "system" fn find_descendant_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let search = &mut *(lparam.0 as *mut DescendantSearch);
    if search.excluded == Some(hwnd) {
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

unsafe fn find_descendant_by_class(
    taskbar_hwnd: HWND,
    class_name: &'static [u8],
    excluded: Option<HWND>,
) -> Option<HWND> {
    let mut search = DescendantSearch {
        class_name,
        excluded,
        found: None,
    };
    let _ = EnumChildWindows(
        Some(taskbar_hwnd),
        Some(find_descendant_callback),
        LPARAM((&mut search as *mut DescendantSearch) as isize),
    );
    search.found
}

unsafe fn find_taskbar_hwnd() -> Option<HWND> {
    let class_name = CString::new("Shell_TrayWnd").ok()?;
    FindWindowA(PCSTR(class_name.as_ptr() as *const u8), PCSTR::null())
        .ok()
        .filter(|hwnd| !hwnd.0.is_null())
}

unsafe fn get_window_rect(hwnd: HWND) -> Option<RECT> {
    let mut rect = RECT::default();
    GetWindowRect(hwnd, &mut rect).ok()?;
    Some(rect)
}

fn needs_reembed(current_parent: Option<HWND>, taskbar_hwnd: HWND) -> bool {
    current_parent != Some(taskbar_hwnd)
}

fn rect_matches_target(rect: RECT, left: i32, top: i32, width: i32, height: i32) -> bool {
    (rect.left - left).abs() <= 1
        && (rect.top - top).abs() <= 1
        && ((rect.right - rect.left) - width).abs() <= 1
        && ((rect.bottom - rect.top) - height).abs() <= 1
}

unsafe fn set_embedded_styles(widget_hwnd: HWND, taskbar_hwnd: HWND) {
    let current_style = GetWindowLongPtrW(widget_hwnd, GWL_STYLE);
    let _ = SetWindowLongPtrW(
        widget_hwnd,
        GWL_STYLE,
        current_style | WS_CHILD.0 as isize,
    );
    let current_ex_style = GetWindowLongPtrW(widget_hwnd, GWL_EXSTYLE);
    let _ = SetWindowLongPtrW(
        widget_hwnd,
        GWL_EXSTYLE,
        current_ex_style | WS_EX_TOOLWINDOW.0 as isize | WS_EX_TRANSPARENT.0 as isize,
    );
    let _ = SetParent(widget_hwnd, Some(taskbar_hwnd));
}

unsafe fn position_widget_dpi_aware(
    window: &WebviewWindow,
    taskbar_hwnd: HWND,
    request: WidgetLayoutRequest,
) -> WidgetLayoutBudget {
    let widget_hwnd = match window.hwnd() {
        Ok(hwnd) if !hwnd.0.is_null() => hwnd,
        _ => return WidgetLayoutBudget::hidden(),
    };
    let taskbar_rect = match get_window_rect(taskbar_hwnd) {
        Some(rect) => rect,
        None => {
            let _ = ShowWindow(widget_hwnd, SW_HIDE);
            record_layout_unavailable("taskbar bounds unavailable");
            return WidgetLayoutBudget::hidden();
        }
    };
    let tray_hwnd = find_descendant_by_class(taskbar_hwnd, b"TrayNotifyWnd", Some(widget_hwnd));
    let task_list_hwnd =
        find_descendant_by_class(taskbar_hwnd, b"MSTaskListWClass", Some(widget_hwnd));
    let target = tray_hwnd
        .and_then(|hwnd| get_window_rect(hwnd))
        .zip(task_list_hwnd.and_then(|hwnd| get_window_rect(hwnd)))
        .and_then(|(tray, task_list)| {
            calculate_widget_layout(
                taskbar_rect,
                tray,
                task_list,
                window.scale_factor().unwrap_or(1.0),
                request,
            )
        });
    let Some(target) = target else {
        let _ = ShowWindow(widget_hwnd, SW_HIDE);
        record_layout_unavailable("missing taskbar descendants or insufficient safe width");
        return WidgetLayoutBudget::hidden();
    };

    let scale = window.scale_factor().unwrap_or(1.0).max(0.25);
    let target_left = taskbar_rect.left + (target.x_logical * scale).round() as i32;
    let target_top = taskbar_rect.top + (target.y_logical * scale).round() as i32;
    let target_width = (target.budget.allocated_width * scale).round() as i32;
    let target_height = (WIDGET_HEIGHT_LOGICAL * scale).round() as i32;
    let already_positioned = get_window_rect(widget_hwnd).is_some_and(|current| {
        rect_matches_target(
            current,
            target_left,
            target_top,
            target_width,
            target_height,
        )
    });
    if !already_positioned {
        let _ = window.set_size(Size::Logical(LogicalSize::new(
            target.budget.allocated_width,
            WIDGET_HEIGHT_LOGICAL,
        )));
        let _ = window.set_position(Position::Logical(LogicalPosition::new(
            target.x_logical,
            target.y_logical,
        )));
    }
    let _ = ShowWindow(widget_hwnd, SW_SHOWNOACTIVATE);
    record_layout_available();
    tracing::debug!(
        target: "dock_mapper::taskbar",
        allocated_width = target.budget.allocated_width,
        constrained = target.budget.constrained,
        x_logical = target.x_logical,
        scale,
        "Widget safe layout refreshed"
    );
    target.budget
}

/// Embeds the widget webview window into the Windows taskbar.
pub fn embed_widget_to_taskbar(window: &WebviewWindow) {
    let span = tracing::info_span!(target: "dock_mapper::taskbar", "embed_widget");
    let _entered = span.enter();
    let window_hwnd = match window.hwnd() {
        Ok(hwnd) if !hwnd.0.is_null() => hwnd,
        Ok(_) => {
            tracing::error!(target: "dock_mapper::taskbar", "Widget HWND is null");
            return;
        }
        Err(error) => {
            tracing::error!(target: "dock_mapper::taskbar", ?error, "Could not get widget HWND");
            return;
        }
    };
    unsafe {
        let Some(taskbar_hwnd) = find_taskbar_hwnd() else {
            let _ = ShowWindow(window_hwnd, SW_HIDE);
            record_layout_unavailable("Shell_TrayWnd unavailable during embed");
            return;
        };
        set_embedded_styles(window_hwnd, taskbar_hwnd);
        position_widget_dpi_aware(window, taskbar_hwnd, WidgetLayoutRequest::default());
    }
    tracing::info!(target: "dock_mapper::taskbar", "Widget embedded successfully");
}

/// Stores no compressed width: every call re-evaluates the full preferred size.
pub fn sync_dynamic_width(
    app: &tauri::AppHandle,
    request: WidgetLayoutRequest,
) -> WidgetLayoutBudget {
    let Some(widget) = app.get_webview_window("taskbar_widget") else {
        return WidgetLayoutBudget::hidden();
    };
    unsafe {
        match find_taskbar_hwnd() {
            Some(taskbar) => position_widget_dpi_aware(&widget, taskbar, request),
            None => {
                if let Ok(widget_hwnd) = widget.hwnd() {
                    let _ = ShowWindow(widget_hwnd, SW_HIDE);
                }
                record_layout_unavailable("Shell_TrayWnd unavailable during width sync");
                WidgetLayoutBudget::hidden()
            }
        }
    }
}

/// Recovery refresh for Explorer restarts, icon changes and display changes.
pub fn refresh_widget_position(
    app: &tauri::AppHandle,
    request: WidgetLayoutRequest,
) -> WidgetLayoutBudget {
    let span = tracing::debug_span!(
        target: "dock_mapper::taskbar",
        "refresh_widget",
        preferred_width = request.preferred_width,
        minimum_width = request.minimum_width
    );
    let _entered = span.enter();
    let Some(widget) = app.get_webview_window("taskbar_widget") else {
        return WidgetLayoutBudget::hidden();
    };
    unsafe {
        let Some(taskbar_hwnd) = find_taskbar_hwnd() else {
            if let Ok(widget_hwnd) = widget.hwnd() {
                let _ = ShowWindow(widget_hwnd, SW_HIDE);
            }
            record_layout_unavailable("Shell_TrayWnd unavailable");
            return WidgetLayoutBudget::hidden();
        };
        if let Ok(widget_hwnd) = widget.hwnd() {
            if needs_reembed(GetParent(widget_hwnd).ok(), taskbar_hwnd) {
                set_embedded_styles(widget_hwnd, taskbar_hwnd);
            }
        }
        position_widget_dpi_aware(&widget, taskbar_hwnd, request)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
        RECT {
            left,
            top,
            right,
            bottom,
        }
    }

    #[test]
    fn explorer_parent_change_requires_widget_reembed() {
        let taskbar = HWND(1_usize as *mut _);
        let previous_taskbar = HWND(2_usize as *mut _);
        assert!(!needs_reembed(Some(taskbar), taskbar));
        assert!(needs_reembed(Some(previous_taskbar), taskbar));
        assert!(needs_reembed(None, taskbar));
    }

    #[test]
    fn layout_uses_the_full_slot_for_left_aligned_buttons() {
        let target = calculate_widget_layout(
            rect(0, 1392, 2560, 1440),
            rect(2224, 1392, 2560, 1440),
            rect(55, 1392, 275, 1440),
            1.0,
            WidgetLayoutRequest {
                preferred_width: 360.0,
                minimum_width: 90.0,
            },
        )
        .unwrap();
        assert_eq!(target.budget.allocated_width, 360.0);
        assert!(!target.budget.constrained);
        assert_eq!(target.x_logical, 1854.0);
    }

    #[test]
    fn centered_buttons_constrain_the_widget_without_overlap() {
        let target = calculate_widget_layout(
            rect(0, 1032, 1920, 1080),
            rect(1660, 1032, 1920, 1080),
            rect(710, 1032, 1510, 1080),
            1.0,
            WidgetLayoutRequest {
                preferred_width: 300.0,
                minimum_width: 72.0,
            },
        )
        .unwrap();
        assert_eq!(target.budget.allocated_width, 130.0);
        assert!(target.budget.constrained);
        assert_eq!(target.x_logical, 1520.0);
    }

    #[test]
    fn dpi_scaled_slot_is_returned_in_logical_pixels() {
        let target = calculate_widget_layout(
            rect(0, 2064, 3840, 2160),
            rect(3300, 2064, 3840, 2160),
            rect(1200, 2064, 2900, 2160),
            2.0,
            WidgetLayoutRequest {
                preferred_width: 240.0,
                minimum_width: 80.0,
            },
        )
        .unwrap();
        assert_eq!(target.budget.allocated_width, 180.0);
        assert!(target.budget.constrained);
    }

    #[test]
    fn slot_smaller_than_the_first_metric_hides_the_widget() {
        let target = calculate_widget_layout(
            rect(0, 1032, 1920, 1080),
            rect(1660, 1032, 1920, 1080),
            rect(710, 1032, 1585, 1080),
            1.0,
            WidgetLayoutRequest {
                preferred_width: 300.0,
                minimum_width: 72.0,
            },
        );
        assert!(target.is_none());
    }

    #[test]
    fn invalid_requests_fall_back_to_safe_limits() {
        let request = normalize_layout_request(WidgetLayoutRequest {
            preferred_width: f64::NAN,
            minimum_width: f64::INFINITY,
        });
        assert_eq!(request.preferred_width, DEFAULT_WIDTH_LOGICAL);
        assert_eq!(request.minimum_width, MIN_WIDTH_LOGICAL);
    }

    #[test]
    fn matching_widget_geometry_does_not_need_another_native_move() {
        let current = rect(100, 4, 280, 44);
        assert!(rect_matches_target(current, 100, 4, 180, 40));
        assert!(rect_matches_target(current, 101, 5, 180, 40));
        assert!(!rect_matches_target(current, 103, 4, 180, 40));
    }
}
