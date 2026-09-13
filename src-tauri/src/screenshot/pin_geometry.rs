use serde::{Deserialize, Serialize};
use tauri::WebviewWindow;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinWindowGeometryRequest {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
    pub sequence: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinWindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub sequence: u64,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct PinGeometryRuntime {
    pub base_width: u32,
    pub base_height: u32,
    pub sequence: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct PhysicalWorkArea {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

pub(super) fn fit_pin_geometry(
    request: PinWindowGeometryRequest,
    runtime: PinGeometryRuntime,
    work_area: PhysicalWorkArea,
) -> Result<PinWindowGeometry, String> {
    if !request.x.is_finite()
        || !request.y.is_finite()
        || !request.width.is_finite()
        || !request.height.is_finite()
        || !request.scale.is_finite()
    {
        return Err("贴图缩放参数无效".into());
    }
    if request.sequence < runtime.sequence {
        return Err("贴图缩放请求已过期".into());
    }
    let base_width = runtime.base_width.max(1);
    let base_height = runtime.base_height.max(1);
    let work_width = (work_area.right - work_area.left).max(1) as f64;
    let work_height = (work_area.bottom - work_area.top).max(1) as f64;
    let requested_scale = request.scale.clamp(0.25, 4.0);
    let maximum_scale = (work_width / base_width as f64)
        .min(work_height / base_height as f64)
        .max(0.01);
    let scale = requested_scale.min(maximum_scale);
    let width = (base_width as f64 * scale).round().max(1.0) as u32;
    let height = (base_height as f64 * scale).round().max(1.0) as u32;
    let maximum_x = work_area.right.saturating_sub(width as i32);
    let maximum_y = work_area.bottom.saturating_sub(height as i32);
    let x = (request.x.round() as i32).clamp(work_area.left, maximum_x.max(work_area.left));
    let y = (request.y.round() as i32).clamp(work_area.top, maximum_y.max(work_area.top));
    Ok(PinWindowGeometry {
        x,
        y,
        width,
        height,
        scale: width as f64 / base_width as f64,
        sequence: request.sequence,
    })
}

#[cfg(target_os = "windows")]
pub(super) fn work_area_for(request: PinWindowGeometryRequest) -> Option<PhysicalWorkArea> {
    use std::mem::size_of;
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromRect, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };

    let rect = RECT {
        left: request.x.round() as i32,
        top: request.y.round() as i32,
        right: (request.x + request.width).round() as i32,
        bottom: (request.y + request.height).round() as i32,
    };
    let monitor = unsafe { MonitorFromRect(&rect, MONITOR_DEFAULTTONEAREST) };
    if monitor.is_invalid() {
        return None;
    }
    let mut info = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        return None;
    }
    Some(PhysicalWorkArea {
        left: info.rcWork.left,
        top: info.rcWork.top,
        right: info.rcWork.right,
        bottom: info.rcWork.bottom,
    })
}

#[cfg(not(target_os = "windows"))]
pub(super) fn work_area_for(request: PinWindowGeometryRequest) -> Option<PhysicalWorkArea> {
    Some(PhysicalWorkArea {
        left: request.x.floor() as i32 - 10_000,
        top: request.y.floor() as i32 - 10_000,
        right: request.x.ceil() as i32 + 10_000,
        bottom: request.y.ceil() as i32 + 10_000,
    })
}

#[cfg(target_os = "windows")]
pub(super) fn apply_pin_geometry(
    window: &WebviewWindow,
    geometry: PinWindowGeometry,
) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
    };
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            geometry.x,
            geometry.y,
            geometry.width as i32,
            geometry.height as i32,
            SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOZORDER,
        )
    }
    .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "windows"))]
pub(super) fn apply_pin_geometry(
    window: &WebviewWindow,
    geometry: PinWindowGeometry,
) -> Result<(), String> {
    window
        .set_position(tauri::PhysicalPosition::new(geometry.x, geometry.y))
        .map_err(|error| error.to_string())?;
    window
        .set_size(tauri::PhysicalSize::new(geometry.width, geometry.height))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime(sequence: u64) -> PinGeometryRuntime {
        PinGeometryRuntime {
            base_width: 400,
            base_height: 200,
            sequence,
        }
    }

    fn work_area() -> PhysicalWorkArea {
        PhysicalWorkArea {
            left: 0,
            top: 0,
            right: 1000,
            bottom: 700,
        }
    }

    #[test]
    fn pin_zoom_preserves_base_aspect_and_clamps_to_work_area() {
        let applied = fit_pin_geometry(
            PinWindowGeometryRequest {
                x: 900.0,
                y: 650.0,
                width: 800.0,
                height: 400.0,
                scale: 2.0,
                sequence: 4,
            },
            runtime(3),
            work_area(),
        )
        .expect("valid geometry");
        assert_eq!((applied.width, applied.height), (800, 400));
        assert_eq!((applied.x, applied.y), (200, 300));
        assert_eq!(applied.scale, 2.0);
    }

    #[test]
    fn pin_zoom_rejects_an_outdated_sequence() {
        let result = fit_pin_geometry(
            PinWindowGeometryRequest {
                x: 0.0,
                y: 0.0,
                width: 400.0,
                height: 200.0,
                scale: 1.0,
                sequence: 2,
            },
            runtime(3),
            work_area(),
        );
        assert_eq!(result.unwrap_err(), "贴图缩放请求已过期");
    }
}
