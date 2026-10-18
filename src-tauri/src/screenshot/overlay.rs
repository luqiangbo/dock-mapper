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
    if app
        .state::<AppState>()
        .overlay_ready
        .lock_or_recover()
        .contains(&label)
    {
        app.emit_to(label.as_str(), "capture-ready", &label)
            .map_err(|error| error.to_string())?;
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

pub(super) fn handle_start_capture(app: &AppHandle) -> Result<u64, String> {
    handle_start_capture_with_mode(app, CaptureMode::Screenshot)
}

pub(super) fn handle_start_quick_ocr(app: &AppHandle) -> Result<u64, String> {
    handle_start_capture_with_mode(app, CaptureMode::QuickOcr)
}

fn handle_start_capture_with_mode(app: &AppHandle, mode: CaptureMode) -> Result<u64, String> {
    let state = app.state::<AppState>();
    let mut startup = state.startup.lock_or_recover();
    if startup.generation().is_some() {
        return Err("截图正在启动，请稍候".into());
    }
    // Allocate before capture starts: acknowledgement and every later result
    // refer to one generation, even when the capture worker finishes late.
    let generation = state.capture_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let status = startup.begin(generation)?;
    match crate::visualizer_effects::suspend_for_capture(app) {
        Ok(token) => *state.visualizer_suspend_token.lock_or_recover() = token,
        Err(error) => {
            tracing::warn!(target: "dock_mapper::key_visualizer", %error, "截图前暂停按键展示失败")
        }
    }
    if let Some(window) = active_overlay_window(app) {
        if let Err(error) = window.hide() {
            tracing::warn!(target: "dock_mapper::capture", %error, "隐藏上一张截图失败");
        }
    }
    *state.capture.lock_or_recover() = None;
    *URI_CAPTURE.lock_or_recover() = None;
    startup::publish(app, &status);
    drop(startup);

    let timeout_app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(startup::STARTUP_TIMEOUT).await;
        let ui = timeout_app.clone();
        if let Err(error) = timeout_app.run_on_main_thread(move || {
            startup::fail_startup(&ui, generation, "截图启动超时（8 秒），请重试".into());
        }) {
            startup::fail_startup(&timeout_app, generation, format!("截图调度失败：{error}"));
        }
    });
    let worker_app = app.clone();
    thread::spawn(move || {
        let started = Instant::now();
        #[cfg(target_os = "windows")]
        unsafe {
            let _ = windows::Win32::Graphics::Dwm::DwmFlush();
        }
        if !worker_app
            .state::<AppState>()
            .startup
            .lock_or_recover()
            .pending(generation)
        {
            return;
        }
        tracing::info!(target: "dock_mapper::capture", generation, "Native capture started");
        let result = capture_active_screen(&worker_app, generation).map(|mut capture| {
            capture.mode = mode;
            capture
        });
        let native_ready_ms = started.elapsed().as_millis();
        let ui_app = worker_app.clone();
        if let Err(error) = worker_app.run_on_main_thread(move || {
            let state = ui_app.state::<AppState>();
            let guard = state.startup.lock_or_recover();
            if !guard.pending(generation) { return; }
            let result = result.and_then(|capture| {
                *state.capture.lock_or_recover() = Some(capture.clone());
                *URI_CAPTURE.lock_or_recover() = Some(capture.clone());
                record_capture_timing(&ui_app, generation, started, native_ready_ms, capture.backend);
                tracing::info!(target: "dock_mapper::capture", generation, "Waiting for capture renderer");
                open_overlay(&ui_app, &capture)
            });
            drop(guard);
            if let Err(error) = result { startup::fail_startup(&ui_app, generation, error); }
        }) { startup::fail_startup(&worker_app, generation, format!("截图显示调度失败：{error}")); }
    });
    Ok(generation)
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
    resume_visualizer(app);
}

pub(super) fn resume_visualizer(app: &AppHandle) {
    let token = app
        .state::<AppState>()
        .visualizer_suspend_token
        .lock_or_recover()
        .take();
    if let Some(token) = token {
        if let Err(error) = crate::visualizer_effects::resume_after_capture(app, token) {
            tracing::warn!(target: "dock_mapper::key_visualizer", %error, "截图后恢复按键展示失败");
        }
    }
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
