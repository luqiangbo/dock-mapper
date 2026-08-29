use serde::Serialize;
use windows::{
    core::BOOL,
    Win32::{
        Foundation::{HWND, LPARAM, RECT},
        Graphics::Dwm::{
            DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
        },
        UI::WindowsAndMessaging::{
            EnumWindows, GetWindowLongPtrW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
            GWL_EXSTYLE, WS_EX_TOOLWINDOW,
        },
    },
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowCandidate {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub z_index: usize,
}

struct Enumeration {
    process_id: u32,
    origin_x: i32,
    origin_y: i32,
    width: u32,
    height: u32,
    scale: f64,
    candidates: Vec<WindowCandidate>,
}

pub fn candidates_for_monitor(
    origin_x: i32,
    origin_y: i32,
    width: u32,
    height: u32,
    scale: f64,
) -> Vec<WindowCandidate> {
    let mut enumeration = Enumeration {
        process_id: std::process::id(),
        origin_x,
        origin_y,
        width,
        height,
        scale: scale.max(1.0),
        candidates: Vec::new(),
    };
    unsafe {
        let _ = EnumWindows(
            Some(collect_window),
            LPARAM((&mut enumeration as *mut Enumeration) as isize),
        );
    }
    enumeration.candidates
}

fn candidate_from_rect(
    id: String,
    rect: RECT,
    origin_x: i32,
    origin_y: i32,
    monitor_width: u32,
    monitor_height: u32,
    scale: f64,
    z_index: usize,
) -> Option<WindowCandidate> {
    let monitor_right = origin_x.saturating_add_unsigned(monitor_width);
    let monitor_bottom = origin_y.saturating_add_unsigned(monitor_height);
    let left = rect.left.max(origin_x);
    let top = rect.top.max(origin_y);
    let right = rect.right.min(monitor_right);
    let bottom = rect.bottom.min(monitor_bottom);
    if right - left < 16 || bottom - top < 16 {
        return None;
    }
    let scale = scale.max(1.0);
    Some(WindowCandidate {
        id,
        x: (left - origin_x) as f64 / scale,
        y: (top - origin_y) as f64 / scale,
        width: (right - left) as f64 / scale,
        height: (bottom - top) as f64 / scale,
        z_index,
    })
}

unsafe extern "system" fn collect_window(hwnd: HWND, parameter: LPARAM) -> BOOL {
    let enumeration = unsafe { &mut *(parameter.0 as *mut Enumeration) };
    if !unsafe { IsWindowVisible(hwnd).as_bool() } || unsafe { IsIconic(hwnd).as_bool() } {
        return BOOL(1);
    }
    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) };
    if process_id == enumeration.process_id {
        return BOOL(1);
    }
    let extended_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
    if extended_style & WS_EX_TOOLWINDOW.0 != 0 {
        return BOOL(1);
    }
    let mut cloaked = 0_u32;
    if unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            (&mut cloaked as *mut u32).cast(),
            size_of::<u32>() as u32,
        )
    }
    .is_ok()
        && cloaked != 0
    {
        return BOOL(1);
    }
    let mut rect = RECT::default();
    if unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&mut rect as *mut RECT).cast(),
            size_of::<RECT>() as u32,
        )
    }
    .is_err()
    {
        return BOOL(1);
    }
    if let Some(candidate) = candidate_from_rect(
        format!("{:x}", hwnd.0 as usize),
        rect,
        enumeration.origin_x,
        enumeration.origin_y,
        enumeration.width,
        enumeration.height,
        enumeration.scale,
        enumeration.candidates.len(),
    ) {
        enumeration.candidates.push(candidate);
    }
    BOOL(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_clips_negative_desktop_coordinates_and_converts_dpi() {
        let candidate = candidate_from_rect(
            "1".into(),
            RECT { left: -2100, top: -20, right: -900, bottom: 700 },
            -1920,
            0,
            1920,
            1080,
            1.5,
            2,
        )
        .unwrap();
        assert_eq!(candidate.x, 0.0);
        assert_eq!(candidate.y, 0.0);
        assert_eq!(candidate.width, 680.0);
        assert_eq!(candidate.height, 700.0 / 1.5);
        assert_eq!(candidate.z_index, 2);
    }

    #[test]
    fn candidate_rejects_tiny_or_off_monitor_rectangles() {
        assert!(candidate_from_rect(
            "tiny".into(),
            RECT { left: 10, top: 10, right: 20, bottom: 20 },
            0,
            0,
            1920,
            1080,
            1.0,
            0,
        )
        .is_none());
        assert!(candidate_from_rect(
            "offscreen".into(),
            RECT { left: 2000, top: 10, right: 2200, bottom: 300 },
            0,
            0,
            1920,
            1080,
            1.0,
            0,
        )
        .is_none());
    }
}
