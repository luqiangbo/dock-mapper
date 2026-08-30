use super::*;

pub(super) fn overlay_label(capture: &CaptureData) -> String {
    format!("overlay-{}", capture.screen_id)
}

pub(super) fn active_overlay_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.state::<AppState>()
        .active_overlay
        .lock()
        .ok()?
        .as_deref()
        .and_then(|label| app.get_webview_window(label))
}

pub(super) fn build_overlay_window(
    app: &AppHandle,
    label: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App("screenshot.html?view=overlay".into()),
    )
    .title("DockMapper 截图")
    .position(x, y)
    .inner_size(width, height)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .content_protected(true)
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub(super) fn open_overlay(app: &AppHandle, capture: &CaptureData) -> Result<(), String> {
    let label = overlay_label(capture);
    if app.get_webview_window(&label).is_none() {
        build_overlay_window(
            app,
            &label,
            capture.bounds.x,
            capture.bounds.y,
            capture.bounds.width,
            capture.bounds.height,
        )?;
    }
    *app.state::<AppState>().active_overlay.lock_or_recover() = Some(label.clone());
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| "Capture overlay is unavailable".to_string())?;
    // A prewarmed overlay can be reused after a display-mode change or for a
    // history image whose editor window is smaller than the monitor. Always
    // refresh native geometry instead of assuming its first size is current.
    #[cfg(target_os = "windows")]
    {
        window
            .set_position(tauri::PhysicalPosition::new(
                capture.physical_origin_x,
                capture.physical_origin_y,
            ))
            .map_err(|error| error.to_string())?;
        window
            .set_size(tauri::PhysicalSize::new(
                capture.physical_width,
                capture.physical_height,
            ))
            .map_err(|error| error.to_string())?;
    }
    // `handle_start_capture` already hides the prewarmed overlay before the
    // native frame is captured. Hiding it again here introduces an extra DWM
    // composition cycle on every screenshot and is the main source of the
    // visible desktop flash on Windows.
    if app.state::<AppState>().overlay_ready.load(Ordering::SeqCst) {
        let _ = app.emit_to(label.as_str(), "capture-ready", &label);
    }
    // The renderer shows the window only after the captured image has decoded
    // and painted. Showing a transparent WebView earlier causes a brief desktop
    // double-image/ghost while its backing surface is still empty.
    Ok(())
}

pub(super) fn record_capture_timing(
    app: &AppHandle,
    generation: u64,
    started: Instant,
    native_ready_ms: u128,
    backend: &'static str,
) {
    let state = app.state::<AppState>();
    if backend == "gdi" {
        state.dxgi_fallback_count.fetch_add(1, Ordering::Relaxed);
    }
    let mut timings = state.capture_timings.lock_or_recover();
    timings.push(CaptureTiming {
        generation,
        started,
        native_ready_ms,
        webview_ready_ms: None,
        backend,
    });
    if timings.len() > 20 {
        timings.remove(0);
    }
}

pub(super) fn prewarm_overlay(app: &AppHandle) {
    if let Ok(monitors) = app.available_monitors() {
        for monitor in monitors {
            let position = monitor.position();
            let size = monitor.size();
            let scale = monitor.scale_factor().max(1.0);
            let id = (position.x as u32).wrapping_mul(31)
                ^ (position.y as u32).wrapping_mul(131)
                ^ size.width.wrapping_mul(17)
                ^ size.height;
            let label = format!("overlay-{id}");
            if app.get_webview_window(&label).is_some() {
                continue;
            }
            let result = build_overlay_window(
                app,
                &label,
                position.x as f64 / scale,
                position.y as f64 / scale,
                size.width as f64 / scale,
                size.height as f64 / scale,
            );
            if let Err(error) = result {
                tracing::warn!(target: "dock_mapper::capture", %label, %error, "Unable to prewarm capture overlay");
                continue;
            }
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.set_position(tauri::PhysicalPosition::new(position.x, position.y));
                let _ = window.set_size(tauri::PhysicalSize::new(size.width, size.height));
            }
        }
    }
}

pub(super) fn show_capture_error(app: &AppHandle, detail: &str) {
    tracing::error!(target: "dock_mapper::capture", %detail, "screenshot capture failed");
    let _ = app.emit("capture-error", detail.to_string());
    let _ = rfd::MessageDialog::new()
        .set_title("Cannot capture screen")
        .set_description(format!(
            "DockMapper 截图无法捕获屏幕。请检查屏幕录制权限，完全退出 DockMapper 后重试。\n\n{detail}"
        ))
        .set_level(rfd::MessageLevel::Error)
        .show();
}

pub(super) fn handle_start_capture(app: &AppHandle) {
    handle_start_capture_with_mode(app, CaptureMode::Screenshot);
}

pub(super) fn handle_start_quick_ocr(app: &AppHandle) {
    handle_start_capture_with_mode(app, CaptureMode::QuickOcr);
}

fn handle_start_capture_with_mode(app: &AppHandle, mode: CaptureMode) {
    let state = app.state::<AppState>();
    if state.capture_in_progress.swap(true, Ordering::SeqCst) {
        return;
    }
    // A shortcut can arrive while the previous WebView is still painting
    // (most visible on the first Windows launch). Hide it before the native
    // capture so the screenshot tool never captures its own transparent surface together
    // with the desktop.
    if let Some(window) = active_overlay_window(app) {
        let _ = window.hide();
    }
    *URI_CAPTURE.lock_or_recover() = None;
    let worker_app = app.clone();
    thread::spawn(move || {
        let started = Instant::now();
        #[cfg(target_os = "windows")]
        // DwmFlush waits for the hide request to reach the compositor without
        // adding a configurable fixed delay to every screenshot.
        unsafe {
            let _ = windows::Win32::Graphics::Dwm::DwmFlush();
        }
        let result = capture_active_screen(&worker_app).map(|mut capture| {
            capture.mode = mode;
            capture
        });
        let native_ready_ms = started.elapsed().as_millis();
        let ui_app = worker_app.clone();
        if let Err(error) = worker_app.run_on_main_thread(move || {
            match result {
                Ok(capture) => {
                    *ui_app.state::<AppState>().capture.lock_or_recover() = Some(capture.clone());
                    *URI_CAPTURE.lock_or_recover() = Some(capture.clone());
                    record_capture_timing(
                        &ui_app,
                        capture.generation,
                        started,
                        native_ready_ms,
                        capture.backend,
                    );
                    if let Err(error) = open_overlay(&ui_app, &capture) {
                        show_capture_error(&ui_app, &error);
                    }
                }
                Err(error) => show_capture_error(&ui_app, &error),
            }
            ui_app
                .state::<AppState>()
                .capture_in_progress
                .store(false, Ordering::SeqCst);
        }) {
            worker_app
                .state::<AppState>()
                .capture_in_progress
                .store(false, Ordering::SeqCst);
            tracing::error!(target: "dock_mapper::capture", %error, "Unable to display capture overlay");
        }
    });
}

pub(super) fn hide_overlay_for_commit(app: &AppHandle) {
    if let Some(window) = active_overlay_window(app) {
        let _ = window.hide();
    }
    // Commit actions can spend tens of milliseconds decoding a PNG and talking
    // to the clipboard. Make the hide visible before that synchronous work so
    // WebView2 never exposes a last composited, DPI-scaled frame on close.
    #[cfg(target_os = "windows")]
    unsafe {
        let _ = windows::Win32::Graphics::Dwm::DwmFlush();
    }
}

pub(super) fn finish_overlay_commit(app: &AppHandle) {
    *app.state::<AppState>().capture.lock_or_recover() = None;
}

pub(super) fn restore_overlay_after_commit_failure(app: &AppHandle) {
    if app.state::<AppState>().capture.lock_or_recover().is_some() {
        if let Some(window) = active_overlay_window(app) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

pub(super) fn close_overlay_impl(app: &AppHandle) {
    hide_overlay_for_commit(app);
    finish_overlay_commit(app);
}
