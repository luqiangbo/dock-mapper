use super::*;
use std::{ffi::c_void, slice};
use windows::Win32::Graphics::Gdi::{BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HGDIOBJ, SRCCOPY};

#[derive(Clone, Copy, Debug)]
pub(super) struct ActiveScreen { pub(super) id: u32, pub(super) bounds: Rect, pub(super) physical_origin_x: i32, pub(super) physical_origin_y: i32, pub(super) physical_width: u32, pub(super) physical_height: u32 }

pub(super) fn active_screen(app: &AppHandle) -> Result<ActiveScreen, String> {
    let cursor = app.cursor_position().map_err(|error| error.to_string())?;
    let monitor = app.monitor_from_point(cursor.x, cursor.y).map_err(|error| error.to_string())?.or_else(|| app.primary_monitor().ok().flatten()).ok_or_else(|| "No Windows monitor is available".to_string())?;
    let position = monitor.position(); let size = monitor.size(); let scale = monitor.scale_factor().max(1.0);
    Ok(ActiveScreen { id: (position.x as u32).wrapping_mul(31) ^ (position.y as u32).wrapping_mul(131) ^ size.width.wrapping_mul(17) ^ size.height, bounds: Rect { x: position.x as f64 / scale, y: position.y as f64 / scale, width: size.width as f64 / scale, height: size.height as f64 / scale }, physical_origin_x: position.x, physical_origin_y: position.y, physical_width: size.width, physical_height: size.height })
}

pub(super) fn bmp_from_bgra(width: u32, height: u32, bgra: &[u8]) -> Result<Arc<[u8]>, String> {
    let expected = (width as usize).checked_mul(height as usize).and_then(|value| value.checked_mul(4)).ok_or_else(|| "Screenshot is too large".to_string())?;
    if width == 0 || height == 0 || bgra.len() != expected { return Err("Invalid BGRA screenshot buffer".into()); }
    let file_size = 54_usize.checked_add(expected).ok_or_else(|| "Screenshot BMP is too large".to_string())?;
    let mut bytes = Vec::with_capacity(file_size); bytes.extend_from_slice(b"BM"); bytes.extend_from_slice(&(file_size as u32).to_le_bytes()); bytes.extend_from_slice(&[0; 4]); bytes.extend_from_slice(&(54_u32).to_le_bytes()); bytes.extend_from_slice(&(40_u32).to_le_bytes()); bytes.extend_from_slice(&(width as i32).to_le_bytes()); bytes.extend_from_slice(&(-(height as i32)).to_le_bytes()); bytes.extend_from_slice(&(1_u16).to_le_bytes()); bytes.extend_from_slice(&(32_u16).to_le_bytes()); bytes.extend_from_slice(&(0_u32).to_le_bytes()); bytes.extend_from_slice(&(expected as u32).to_le_bytes()); bytes.extend_from_slice(&[0; 16]); bytes.extend_from_slice(bgra); Ok(Arc::from(bytes.into_boxed_slice()))
}

fn is_blank_bgra(width: u32, height: u32, pixels: &[u8]) -> bool { if width < 2 || height < 2 { return true; } let first = &pixels[..4]; let mut varied = 0; for pixel in pixels.chunks_exact(4).step_by(((width as usize * height as usize) / 600).max(1)) { let difference = (pixel[0] as i16 - first[0] as i16).unsigned_abs() + (pixel[1] as i16 - first[1] as i16).unsigned_abs() + (pixel[2] as i16 - first[2] as i16).unsigned_abs(); if difference > 36 { varied += 1; if varied > 6 { return false; } } } true }

fn capture_gdi(rect: &ActiveScreen) -> Result<(Arc<[u8]>, u32, u32), String> { unsafe {
    let desktop = GetDC(None); if desktop.0.is_null() { return Err("GetDC failed".into()); }
    let memory = CreateCompatibleDC(Some(desktop)); if memory.0.is_null() { let _ = ReleaseDC(None, desktop); return Err("CreateCompatibleDC failed".into()); }
    let mut pixels: *mut c_void = std::ptr::null_mut();
    let info = BITMAPINFO { bmiHeader: BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: rect.physical_width as i32, biHeight: -(rect.physical_height as i32), biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() }, ..Default::default() };
    let bitmap = CreateDIBSection(Some(memory), &info, DIB_RGB_COLORS, &mut pixels, None, 0).map_err(|error| error.to_string())?; if bitmap.0.is_null() || pixels.is_null() { let _ = DeleteDC(memory); let _ = ReleaseDC(None, desktop); return Err("CreateDIBSection failed".into()); }
    let old = SelectObject(memory, HGDIOBJ(bitmap.0));
    let result = BitBlt(memory, 0, 0, rect.physical_width as i32, rect.physical_height as i32, Some(desktop), rect.physical_origin_x, rect.physical_origin_y, SRCCOPY | CAPTUREBLT).map_err(|error| error.to_string()).and_then(|_| { let length = rect.physical_width as usize * rect.physical_height as usize * 4; let bytes = slice::from_raw_parts(pixels.cast::<u8>(), length); if is_blank_bgra(rect.physical_width, rect.physical_height, bytes) { return Err("Screen capture returned a blank image".into()); } Ok((bmp_from_bgra(rect.physical_width, rect.physical_height, bytes)?, rect.physical_width, rect.physical_height)) });
    let _ = SelectObject(memory, old); let _ = DeleteObject(HGDIOBJ(bitmap.0)); let _ = DeleteDC(memory); let _ = ReleaseDC(None, desktop); result
} }

pub(super) fn capture_with_gdi_fallback<T>(primary: Result<T, String>, fallback: impl FnOnce(&str) -> Result<T, String>) -> Result<(T, &'static str), String> { match primary { Ok(frame) => Ok((frame, "dxgi")), Err(dxgi_error) => fallback(&dxgi_error).map(|frame| (frame, "gdi")).map_err(|gdi_error| format!("DXGI 捕获失败：{dxgi_error}；GDI 兼容回退失败：{gdi_error}")) } }

pub(super) fn capture_active_screen(app: &AppHandle) -> Result<CaptureData, String> {
    let screen = active_screen(app)?; let rect = crate::dxgi_capture::MonitorRect { x: screen.physical_origin_x, y: screen.physical_origin_y, width: screen.physical_width, height: screen.physical_height };
    let dxgi = app.state::<AppState>().dxgi_capture.lock().map_err(|_| "DXGI capture state is unavailable".to_string())?.capture(rect, 20).and_then(|frame| Ok((bmp_from_bgra(frame.width, frame.height, &frame.bytes)?, frame.width, frame.height)));
    let ((bmp, image_width, image_height), backend) = capture_with_gdi_fallback(dxgi, |error| { tracing::warn!(target: "dock_mapper::capture", %error, "falling back to native GDI capture"); capture_gdi(&screen) })?;
    let scale_factor = image_width as f64 / screen.bounds.width.max(1.0); let window_candidates = window_candidates::candidates_for_monitor(screen.physical_origin_x, screen.physical_origin_y, image_width, image_height, scale_factor);
    Ok(CaptureData { bmp, generation: app.state::<AppState>().capture_generation.fetch_add(1, Ordering::SeqCst) + 1, bounds: screen.bounds, image_width, image_height, scale_factor, screen_id: screen.id, physical_origin_x: screen.physical_origin_x, physical_origin_y: screen.physical_origin_y, physical_width: image_width, physical_height: image_height, window_candidates, backend, mode: CaptureMode::Screenshot })
}
