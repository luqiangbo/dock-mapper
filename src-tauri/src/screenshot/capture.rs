use super::*;

pub(super) fn bmp_from_bgra(width: u32, height: u32, bgra: &[u8]) -> Result<Arc<[u8]>, String> {
    let row_bytes = width as usize * 4;
    let expected = row_bytes
        .checked_mul(height as usize)
        .ok_or_else(|| "Screenshot is too large".to_string())?;
    if width == 0 || height == 0 || bgra.len() != expected {
        return Err("Invalid BGRA screenshot buffer".into());
    }
    // A top-down BI_RGB 32-bit BMP is decoded natively by WebView2. It avoids
    // PNG compression and Base64/JSON copies on the shortcut-to-overlay path.
    let file_size = 54_usize
        .checked_add(expected)
        .ok_or_else(|| "Screenshot BMP is too large".to_string())?;
    let mut bytes = Vec::with_capacity(file_size);
    bytes.extend_from_slice(b"BM");
    bytes.extend_from_slice(&(file_size as u32).to_le_bytes());
    bytes.extend_from_slice(&[0; 4]);
    bytes.extend_from_slice(&(54_u32).to_le_bytes());
    bytes.extend_from_slice(&(40_u32).to_le_bytes());
    bytes.extend_from_slice(&(width as i32).to_le_bytes());
    bytes.extend_from_slice(&(-(height as i32)).to_le_bytes());
    bytes.extend_from_slice(&(1_u16).to_le_bytes());
    bytes.extend_from_slice(&(32_u16).to_le_bytes());
    bytes.extend_from_slice(&(0_u32).to_le_bytes());
    bytes.extend_from_slice(&(expected as u32).to_le_bytes());
    bytes.extend_from_slice(&[0; 16]);
    bytes.extend_from_slice(bgra);
    Ok(Arc::from(bytes.into_boxed_slice()))
}

pub(super) fn bmp_from_rgba(image: &RgbaImage) -> Result<Arc<[u8]>, String> {
    let mut bgra = image.as_raw().clone();
    for pixel in bgra.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    bmp_from_bgra(image.width(), image.height(), &bgra)
}

pub(super) fn image_is_blank(image: &RgbaImage) -> bool {
    if image.width() < 2 || image.height() < 2 {
        return true;
    }
    let first = image.get_pixel(0, 0);
    let step_x = (image.width() / 30).max(1);
    let step_y = (image.height() / 20).max(1);
    let mut varied = 0;
    for y in (0..image.height()).step_by(step_y as usize) {
        for x in (0..image.width()).step_by(step_x as usize) {
            let pixel = image.get_pixel(x, y);
            let difference = (pixel[0] as i16 - first[0] as i16).unsigned_abs()
                + (pixel[1] as i16 - first[1] as i16).unsigned_abs()
                + (pixel[2] as i16 - first[2] as i16).unsigned_abs();
            if difference > 36 {
                varied += 1;
                if varied > 6 {
                    return false;
                }
            }
        }
    }
    true
}

pub(super) fn capture_with_gdi_fallback<T>(
    primary: Result<T, String>,
    fallback: impl FnOnce(&str) -> Result<T, String>,
) -> Result<(T, &'static str), String> {
    match primary {
        Ok(frame) => Ok((frame, "dxgi")),
        Err(dxgi_error) => fallback(&dxgi_error)
            .map(|frame| (frame, "gdi"))
            .map_err(|gdi_error| {
                format!("DXGI 捕获失败：{dxgi_error}；GDI 兼容回退失败：{gdi_error}")
            }),
    }
}

pub(super) fn active_screen(app: &AppHandle) -> Result<Screen, String> {
    let raw_cursor = app.cursor_position().map_err(|error| error.to_string())?;
    let screens = Screen::all().map_err(|error| error.to_string())?;
    let cursor = (raw_cursor.x, raw_cursor.y);

    // Prefer the Tauri monitor geometry when available. This avoids the
    // screenshots crate's `from_point` helper, which can interpret a mixed-DPI
    // cursor using a different coordinate space and occasionally select the
    // adjacent display. Geometry matching is tolerant of either logical or
    // physical monitor coordinates because Windows reports the two depending
    // on the process DPI-awareness mode.
    let monitor = app
        .monitor_from_point(cursor.0, cursor.1)
        .map_err(|error| error.to_string())?;
    let monitor_geometry = monitor.map(|monitor| {
        let scale = monitor.scale_factor().max(1.0);
        let position = monitor.position();
        let size = monitor.size();
        (
            Rect {
                x: position.x as f64 / scale,
                y: position.y as f64 / scale,
                width: size.width as f64 / scale,
                height: size.height as f64 / scale,
            },
            Rect {
                x: position.x as f64,
                y: position.y as f64,
                width: size.width as f64,
                height: size.height as f64,
            },
        )
    });
    let selected = monitor_geometry
        .as_ref()
        .and_then(|(logical, physical)| {
            screens
                .iter()
                .min_by(|left, right| {
                    screen_geometry_score(left, logical, physical)
                        .total_cmp(&screen_geometry_score(right, logical, physical))
                })
                .copied()
        })
        .or_else(|| select_screen_containing_point(&screens, cursor));
    let selected = selected
        // A cursor can be sampled on the one-pixel seam between two displays.
        // Choose the nearest display rather than silently falling back to the
        // first enumerated display (which is often the primary screen).
        .or_else(|| nearest_screen(&screens, cursor));
    selected.ok_or_else(|| "No screen is available".into())
}

pub(super) fn screen_rect(screen: &Screen) -> Rect {
    let info = screen.display_info;
    Rect {
        x: info.x as f64,
        y: info.y as f64,
        width: info.width as f64,
        height: info.height as f64,
    }
}

pub(super) fn rect_distance_squared(rect: Rect, point: (f64, f64)) -> f64 {
    let right = rect.x + rect.width;
    let bottom = rect.y + rect.height;
    let dx = if point.0 < rect.x {
        rect.x - point.0
    } else if point.0 > right {
        point.0 - right
    } else {
        0.0
    };
    let dy = if point.1 < rect.y {
        rect.y - point.1
    } else if point.1 > bottom {
        point.1 - bottom
    } else {
        0.0
    };
    dx * dx + dy * dy
}

pub(super) fn select_screen_containing_point(screens: &[Screen], point: (f64, f64)) -> Option<Screen> {
    screens
        .iter()
        .filter(|screen| {
            let rect = screen_rect(screen);
            // Use half-open bounds so a cursor exactly on a shared edge is
            // assigned to one monitor deterministically instead of making two
            // displays look like one oversized capture surface.
            point.0 >= rect.x
                && point.0 < rect.x + rect.width
                && point.1 >= rect.y
                && point.1 < rect.y + rect.height
        })
        // If two coordinate spaces overlap at a mixed-DPI boundary, prefer the
        // smallest matching display so the cursor never leaks into its sibling.
        .min_by_key(|screen| {
            let rect = screen_rect(screen);
            (rect.width * rect.height) as u64
        })
        .copied()
}

pub(super) fn nearest_screen(screens: &[Screen], point: (f64, f64)) -> Option<Screen> {
    screens
        .iter()
        .min_by(|left, right| {
            rect_distance_squared(screen_rect(left), point)
                .total_cmp(&rect_distance_squared(screen_rect(right), point))
        })
        .copied()
}

pub(super) fn screen_geometry_score(screen: &Screen, logical: &Rect, physical: &Rect) -> f64 {
    let info = screen_rect(screen);
    let score = |expected: &Rect| {
        let position = (info.x - expected.x).abs() + (info.y - expected.y).abs();
        let size = (info.width - expected.width).abs() + (info.height - expected.height).abs();
        position + size
    };
    score(logical).min(score(physical))
}

#[cfg(target_os = "windows")]
pub(super) fn monitor_screen_score(screen: &Screen, monitor: &Monitor) -> f64 {
    let scale = monitor.scale_factor().max(1.0);
    let position = monitor.position();
    let size = monitor.size();
    let logical = Rect {
        x: position.x as f64 / scale,
        y: position.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    };
    let physical = Rect {
        x: position.x as f64,
        y: position.y as f64,
        width: size.width as f64,
        height: size.height as f64,
    };
    screen_geometry_score(screen, &logical, &physical)
}

pub(super) fn capture_active_screen(app: &AppHandle) -> Result<CaptureData, String> {
    let span = tracing::info_span!(target: "dock_mapper::capture", "screenshot_capture");
    let _entered = span.enter();
    let screen = active_screen(app)?;
    let info = screen.display_info;
    let (bmp, image_width, image_height, bounds, physical_origin_x, physical_origin_y, backend) = {
        // Tao/Tauri makes the process Per-Monitor-V2 DPI aware. `screenshots`
        // also multiplies DisplayInfo dimensions by its detected scale factor,
        // which can scale an already-physical Windows desktop a second time.
        // Capture the monitor's real backing-pixel size directly instead.
        // Resolve the native monitor from the already-selected `Screen`, not
        // from a second cursor sample. The cursor can cross a display while
        // the capture worker is starting; mixing the first screen with the
        // second monitor's size was the source of occasional cross-display
        // captures on Windows.
        let monitor = app
            .available_monitors()
            .map_err(|error| error.to_string())?
            .into_iter()
            .min_by(|left, right| {
                monitor_screen_score(&screen, left).total_cmp(&monitor_screen_score(&screen, right))
            })
            .or_else(|| app.primary_monitor().ok().flatten())
            .ok_or_else(|| "No Windows monitor is available".to_string())?;
        let physical_size = monitor.size();
        let scale = monitor.scale_factor().max(1.0);
        let position = monitor.position();
        let rect = crate::dxgi_capture::MonitorRect {
            x: position.x,
            y: position.y,
            width: physical_size.width,
            height: physical_size.height,
        };
        let dxgi = app
            .state::<AppState>()
            .dxgi_capture
            .lock()
            .map_err(|_| "DXGI capture state is unavailable".to_string())?
            .capture(rect, 20)
            .and_then(|frame| {
                Ok((
                    bmp_from_bgra(frame.width, frame.height, &frame.bytes)?,
                    frame.width,
                    frame.height,
                ))
            });
        let ((bmp, image_width, image_height), backend) = capture_with_gdi_fallback(
            dxgi,
            |error| {
                // Desktop Duplication is unavailable in some RDP, protected
                // content and multi-GPU configurations. Keep a verified GDI
                // fallback so a fast path failure never disables screenshots.
                tracing::warn!(target: "dock_mapper::capture", %error, "falling back to compatibility capture");
                let image = screen
                    .capture_area_ignore_area_check(0, 0, physical_size.width, physical_size.height)
                    .map_err(|fallback| fallback.to_string())?;
                if image_is_blank(&image) {
                    return Err("Screen capture returned a blank image".into());
                }
                let width = image.width();
                let height = image.height();
                Ok((bmp_from_rgba(&image)?, width, height))
            },
        )?;
        (
            bmp,
            image_width,
            image_height,
            Rect {
                x: position.x as f64 / scale,
                y: position.y as f64 / scale,
                width: physical_size.width as f64 / scale,
                height: physical_size.height as f64 / scale,
            },
            position.x,
            position.y,
            backend,
        )
    };
    let scale_factor = image_width as f64 / bounds.width.max(1.0);
    let window_candidates = window_candidates::candidates_for_monitor(
        physical_origin_x,
        physical_origin_y,
        image_width,
        image_height,
        scale_factor,
    );
    Ok(CaptureData {
        bmp,
        generation: app
            .state::<AppState>()
            .capture_generation
            .fetch_add(1, Ordering::SeqCst)
            + 1,
        bounds,
        image_width,
        image_height,
        scale_factor,
        screen_id: info.id,
        physical_origin_x,
        physical_origin_y,
        physical_width: image_width,
        physical_height: image_height,
        window_candidates,
        backend,
    })
}
