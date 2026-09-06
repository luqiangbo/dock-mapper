use std::{
    collections::HashSet,
    fs,
    io::Cursor,
    path::PathBuf,
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, LazyLock, Mutex, MutexGuard,
    },
    thread,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

mod capture;
mod clipboard;
use capture::*;
mod runtime;
mod pin_runtime;
mod overlay;
pub(crate) mod output;
mod shortcut;
use overlay::*;
use output::*;
pub use output::{copy_png_bytes, pin_external_image};
use pin_runtime::*;
pub use pin_runtime::PinOptions;
pub use runtime::{runtime_status, RuntimeStatus};
pub use shortcut::ShortcutRuntimeStatus;
use runtime::URI_CAPTURE;
#[path = "screenshot/windows.rs"]
mod window_candidates;

trait DiagnosticMutex<T> {
    fn lock_or_recover(&self) -> MutexGuard<'_, T>;
}

impl<T> DiagnosticMutex<T> for Mutex<T> {
    fn lock_or_recover(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|poisoned| {
            tracing::error!(target: "dock_mapper::state", "recovering poisoned screenshot state");
            poisoned.into_inner()
        })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CaptureMode {
    #[default]
    Screenshot,
    QuickOcr,
}

#[derive(Clone)]
struct CaptureData {
    bmp: Arc<[u8]>,
    generation: u64,
    bounds: Rect,
    image_width: u32,
    image_height: u32,
    scale_factor: f64,
    screen_id: u32,
    physical_origin_x: i32,
    physical_origin_y: i32,
    physical_width: u32,
    physical_height: u32,
    window_candidates: Vec<window_candidates::WindowCandidate>,
    backend: &'static str,
    mode: CaptureMode,
}

#[derive(Clone, Debug)]
struct CaptureTiming {
    generation: u64,
    started: Instant,
    native_ready_ms: u128,
    webview_ready_ms: Option<u128>,
    backend: &'static str,
}

pub struct AppState {
    capture: Mutex<Option<CaptureData>>,
    pin_runtime: Mutex<PinRuntimeState>,
    pin_generation: AtomicU64,
    // Ctrl+2 deliberately consumes only a PNG exported by the editor. Keeping
    // it separate from the frozen full-screen capture prevents accidental
    // pinning before the user has confirmed a selection.
    confirmed_png: Mutex<Option<Arc<[u8]>>>,
    shortcut_registry: Mutex<shortcut::ShortcutRegistryState>,
    overlay_ready: AtomicBool,
    active_overlay: Mutex<Option<String>>,
    capture_in_progress: AtomicBool,
    capture_generation: AtomicU64,
    capture_timings: Mutex<Vec<CaptureTiming>>,
    dxgi_fallback_count: AtomicU64,
    dxgi_capture: Mutex<crate::dxgi_capture::CaptureManager>,
}


pub fn create_state() -> AppState {
    AppState {
        capture: Mutex::new(None),
        pin_runtime: Mutex::new(PinRuntimeState::default()),
        pin_generation: AtomicU64::new(0),
        confirmed_png: Mutex::new(None),
        shortcut_registry: Mutex::new(shortcut::ShortcutRegistryState::default()),
        overlay_ready: AtomicBool::new(false),
        active_overlay: Mutex::new(None),
        capture_in_progress: AtomicBool::new(false),
        capture_generation: AtomicU64::new(0),
        capture_timings: Mutex::new(Vec::with_capacity(20)),
        dxgi_fallback_count: AtomicU64::new(0),
        dxgi_capture: Mutex::new(crate::dxgi_capture::CaptureManager::default()),
    }
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    // Build hidden WebViews up front. First capture then only captures pixels,
    // renders the in-memory BMP frame and shows the overlay.
    prewarm_overlay(app);
    {
        let warmup_app = app.clone();
        thread::spawn(move || {
            if let Ok(mut capture) = warmup_app.state::<AppState>().dxgi_capture.lock() {
                capture.prewarm();
            }
        });
    }

    let shortcuts = app
        .state::<crate::AppState>()
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())?
        .screenshot_config
        .clone();
    shortcut::register_initial(app, &shortcuts);
    Ok(())
}


pub fn start_capture(app: &AppHandle) {
    handle_start_capture(app);
}

pub fn start_quick_ocr_capture(app: &AppHandle) {
    handle_start_quick_ocr(app);
}

pub(crate) fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        tracing::warn!(target: "dock_mapper::window", "主窗口不存在，无法显示");
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

pub(crate) fn open_screenshot_history(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        tracing::warn!(target: "dock_mapper::window", "主窗口不存在，无法打开截图历史");
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = app.emit_to(
        "main",
        "navigate-main",
        serde_json::json!({ "page": "screenshot", "tab": "history" }),
    );
    let _ = window.set_focus();
}

pub(crate) fn pin_recent_screenshot(app: &AppHandle) {
    if let Err(error) = pin_confirmed_image(app) {
        let _ = rfd::MessageDialog::new()
            .set_title("DockMapper 截图")
            .set_description(error)
            .set_level(rfd::MessageLevel::Info)
            .show();
    }
}

#[tauri::command]
pub fn start_screenshot(app: AppHandle) {
    handle_start_capture(&app);
}

#[tauri::command]
pub fn start_quick_ocr(app: AppHandle, service: State<'_, crate::ocr::OcrService>) {
    // Engine preparation is asynchronous and does not delay the capture UI.
    service.prepare();
    handle_start_quick_ocr(&app);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullScreenshot {
    url: String,
    generation: u64,
    display_width: f64,
    display_height: f64,
    image_width: u32,
    image_height: u32,
    overlay_label: String,
    window_candidates: Vec<window_candidates::WindowCandidate>,
    mode: CaptureMode,
}


pub fn serve_capture_uri(request: Request<Vec<u8>>) -> Response<std::borrow::Cow<'static, [u8]>> {
    let path = request.uri().path().trim_start_matches('/');
    let Some(raw_generation) = path
        .strip_prefix("capture/")
        .and_then(|value| value.strip_suffix(".bmp"))
    else {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(std::borrow::Cow::Owned(Vec::new()))
            .unwrap();
    };
    let Ok(generation) = raw_generation.parse::<u64>() else {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body(std::borrow::Cow::Owned(Vec::new()))
            .unwrap();
    };
    let bytes = URI_CAPTURE.lock().ok().and_then(|capture| {
        capture
            .as_ref()
            .filter(|capture| capture.generation == generation)
            .map(|capture| capture.bmp.to_vec())
    });
    match bytes {
        Some(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", "image/bmp")
            .header("Cache-Control", "no-store, no-cache, must-revalidate")
            .header("Pragma", "no-cache")
            // The overlay is served from Tauri's application origin while the
            // custom protocol becomes http://dockmapper-shot.localhost on
            // Windows. Canvas annotation/export needs this image to remain
            // origin-clean rather than becoming a tainted canvas.
            .header("Access-Control-Allow-Origin", "*")
            .body(std::borrow::Cow::Owned(bytes))
            .unwrap(),
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(std::borrow::Cow::Owned(Vec::new()))
            .unwrap(),
    }
}



fn build_pin_window(
    app: &AppHandle,
    id: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    WebviewWindowBuilder::new(
        app,
        id,
        WebviewUrl::App(format!("screenshot.html?view=pin&id={id}").into()),
    )
    .title("DockMapper 截图")
    .position(x, y)
    .inner_size(width, height)
    .min_inner_size(60.0, 60.0)
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .resizable(false)
    .always_on_top(true)
    .visible(false)
    .build()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

fn release_pin_runtime(app: &AppHandle, id: &str, destroy_window: bool) {
    if destroy_window {
        if let Some(window) = app.get_webview_window(id) {
            let _ = window.destroy();
        }
    }
    app.state::<AppState>()
        .pin_runtime
        .lock_or_recover()
        .remove(id);
}


pub fn update_shortcuts(
    app: &AppHandle,
    previous: &crate::config::ScreenshotConfig,
    next: &crate::config::ScreenshotConfig,
) -> Result<(), String> {
    shortcut::replace_changed(app, previous, next)
}

pub fn replace_all_shortcuts(
    app: &AppHandle,
    config: &crate::config::ScreenshotConfig,
) -> Result<(), String> {
    shortcut::replace_all(app, config)
}

pub fn shortcut_statuses(
    app: &AppHandle,
) -> Result<Vec<shortcut::ShortcutRuntimeStatus>, String> {
    let config = app
        .state::<crate::AppState>()
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())?
        .screenshot_config
        .clone();
    shortcut::statuses(app, &config)
}

pub(crate) fn toggle_latest_pin(app: &AppHandle) {
    loop {
        let (latest, ready) = {
            let state = app.state::<AppState>();
            let runtime = state.pin_runtime.lock_or_recover();
            let latest = runtime.latest().map(str::to_owned);
            let ready = latest.as_ref().is_some_and(|id| runtime.ready.contains(id));
            (latest, ready)
        };
        let Some(id) = latest else {
            tracing::debug!(target: "dock_mapper::pin", "没有可显隐的贴图窗口");
            return;
        };
        let Some(window) = app.get_webview_window(&id) else {
            app.state::<AppState>()
                .pin_runtime
                .lock_or_recover()
                .remove(&id);
            continue;
        };
        if !ready {
            tracing::debug!(target: "dock_mapper::pin", pin_id = %id, "最近贴图仍在加载，忽略显隐快捷键");
            return;
        }
        let result = match window.is_visible() {
            Ok(true) => window.hide(),
            Ok(false) => window.show(),
            Err(error) => {
                tracing::warn!(target: "dock_mapper::pin", pin_id = %id, %error, "读取贴图可见状态失败");
                return;
            }
        };
        if let Err(error) = result {
            tracing::warn!(target: "dock_mapper::pin", pin_id = %id, %error, "切换贴图可见状态失败");
        }
        return;
    }
}

#[tauri::command]
pub fn close_overlay(app: AppHandle) {
    if let Some(service) = app.try_state::<crate::ocr::OcrService>() {
        service.cancel();
    }
    let _ = app.state::<crate::AppState>().images.clear();
    close_overlay_impl(&app);
}

#[tauri::command]
pub fn show_capture_overlay(
    app: AppHandle,
    generation: Option<u64>,
    label: Option<String>,
) -> Result<bool, String> {
    let capture = app.state::<AppState>().capture.lock_or_recover().clone();
    let Some(capture) = capture else {
        return Err("No screenshot is available".into());
    };
    if let Some(generation) = generation {
        if capture.generation != generation {
            return Err("Capture frame has been superseded".into());
        }
    }
    let active_label = app
        .state::<AppState>()
        .active_overlay
        .lock_or_recover()
        .clone()
        .ok_or_else(|| "Capture overlay is unavailable".to_string())?;
    if label.is_some_and(|candidate| candidate != active_label) {
        return Err("Capture overlay has been superseded".into());
    }
    let window = app
        .get_webview_window(&active_label)
        .ok_or_else(|| "Capture overlay is unavailable".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn overlay_ready(app: AppHandle, label: String) {
    let state = app.state::<AppState>();
    state.overlay_ready.store(true, Ordering::SeqCst);
    if state.capture.lock_or_recover().is_some()
        && state.active_overlay.lock_or_recover().as_deref() == Some(label.as_str())
    {
        let _ = app.emit_to(label.as_str(), "capture-ready", &label);
    }
}

#[tauri::command]
pub fn get_full_screenshot(
    state: State<AppState>,
    label: String,
) -> Result<FullScreenshot, String> {
    let capture = state
        .capture
        .lock_or_recover()
        .clone()
        .ok_or_else(|| "No screenshot is available".to_string())?;
    if state.active_overlay.lock_or_recover().as_deref() != Some(label.as_str()) {
        return Err("Capture overlay has been superseded".into());
    }
    Ok(FullScreenshot {
        url: format!(
            "http://dockmapper-shot.localhost/capture/{}.bmp",
            capture.generation
        ),
        generation: capture.generation,
        display_width: capture.bounds.width,
        display_height: capture.bounds.height,
        image_width: capture.image_width,
        image_height: capture.image_height,
        overlay_label: label,
        window_candidates: capture.window_candidates,
        mode: capture.mode,
    })
}

#[tauri::command]
pub fn report_capture_rendered(
    app: AppHandle,
    generation: u64,
    label: String,
) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let is_current = state
        .capture
        .lock()
        .map_err(|_| "截图状态已损坏".to_string())?
        .as_ref()
        .is_some_and(|capture| capture.generation == generation);
    if !is_current {
        return Err("Capture frame has been superseded".into());
    }
    let mut timings = state.capture_timings.lock_or_recover();
    if let Some(timing) = timings
        .iter_mut()
        .rev()
        .find(|timing| timing.generation == generation)
    {
        timing.webview_ready_ms = Some(timing.started.elapsed().as_millis());
        tracing::info!(
            target: "dock_mapper::capture",
            generation = timing.generation,
            native_ms = timing.native_ready_ms,
            webview_ms = timing.webview_ready_ms.unwrap_or_default(),
            backend = timing.backend,
            "Screenshot rendered"
        );
    }
    let mut completed = timings
        .iter()
        .filter_map(|timing| timing.webview_ready_ms)
        .collect::<Vec<_>>();
    if completed.len() >= 5 && generation % 5 == 0 {
        completed.sort_unstable();
        let p95_index = ((completed.len() as f64 * 0.95).ceil() as usize)
            .saturating_sub(1)
            .min(completed.len() - 1);
        tracing::info!(
            target: "dock_mapper::capture",
            sample_count = completed.len(),
            p95_ms = completed[p95_index],
            "Recent screenshot latency"
        );
    }
    drop(timings);
    show_capture_overlay(app, Some(generation), Some(label))
}

#[tauri::command]
pub fn check_screen_permission() -> serde_json::Value {
    serde_json::json!({ "granted": true, "status": "granted" })
}

fn pin_image_impl(
    app: AppHandle,
    data: Arc<[u8]>,
    close_source_overlay: bool,
) -> Result<String, String> {
    // Reading the PNG header is enough to size the native window. Fully
    // decoding a large/long screenshot on Tauri's IPC thread can starve the
    // Windows event loop, which also prevents Cancel and the global shortcut
    // from being processed.
    let (pixel_width, pixel_height) = image::ImageReader::new(Cursor::new(data.as_ref()))
        .with_guessed_format()
        .map_err(|error| error.to_string())?
        .into_dimensions()
        .map_err(|error| error.to_string())?;
    let capture = app.state::<AppState>().capture.lock_or_recover().clone();
    let scale = capture
        .as_ref()
        .map(|capture| capture.scale_factor)
        .unwrap_or(1.0)
        .max(1.0);
    let natural_width = pixel_width as f64 / scale;
    let natural_height = pixel_height as f64 / scale;
    let (screen_id, screen_bounds) = if let Some(capture) = capture.as_ref() {
        (capture.screen_id, capture.bounds)
    } else {
        let info = active_screen(&app)?;
        (
            info.id,
            Rect {
                x: info.bounds.x,
                y: info.bounds.y,
                width: info.bounds.width,
                height: info.bounds.height,
            },
        )
    };
    let max_width = (screen_bounds.width - 40.0).max(160.0);
    let max_height = (screen_bounds.height - 40.0).max(160.0);
    let fit = (max_width / natural_width)
        .min(max_height / natural_height)
        .min(1.0);
    let window_width = (natural_width * fit).max(60.0);
    let window_height = (natural_height * fit).max(60.0);
    let id = format!(
        "pin-{}",
        app.state::<AppState>()
            .pin_generation
            .fetch_add(1, Ordering::SeqCst)
            + 1
    );
    let slot = app
        .state::<AppState>()
        .pin_runtime
        .lock_or_recover()
        .reserve(id.clone(), data.clone(), screen_id);
    let layout = pin_window_layout(screen_bounds, window_width, window_height, slot);
    #[cfg(target_os = "windows")]
    let physical_geometry = capture.as_ref().map(|capture| {
        logical_pin_to_physical(
            capture.bounds,
            capture.physical_origin_x,
            capture.physical_origin_y,
            capture.scale_factor,
            layout,
        )
    });

    if let Err(error) = build_pin_window(&app, &id, layout.x, layout.y, layout.width, layout.height)
    {
        release_pin_runtime(&app, &id, true);
        return Err(error);
    }

    let initialize_result = (|| {
        let window = app
            .get_webview_window(&id)
            .ok_or_else(|| "Pin window is unavailable".to_string())?;
        let destroyed_app = app.clone();
        let destroyed_id = id.clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                destroyed_app
                    .state::<AppState>()
                    .pin_runtime
                    .lock_or_recover()
                    .remove(&destroyed_id);
            }
        });
        #[cfg(target_os = "windows")]
        {
            if let Some((x, y, width, height)) = physical_geometry {
                // A physical window pixel now maps to one captured image pixel.
                // This also avoids sizing the reused WebView with the DPI of the
                // monitor where it was prewarmed instead of the capture monitor.
                window
                    .set_position(tauri::PhysicalPosition::new(x, y))
                    .map_err(|error| error.to_string())?;
                window
                    .set_size(tauri::PhysicalSize::new(width, height))
                    .map_err(|error| error.to_string())?;
            } else {
                window
                    .set_position(tauri::LogicalPosition::new(layout.x, layout.y))
                    .map_err(|error| error.to_string())?;
                window
                    .set_size(tauri::LogicalSize::new(layout.width, layout.height))
                    .map_err(|error| error.to_string())?;
            }
            let _ = window.emit("pin-image-updated", &id);
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = initialize_result {
        release_pin_runtime(&app, &id, true);
        return Err(error);
    }
    remember_confirmed_image(&app, data);
    let fallback_app = app.clone();
    let fallback_id = id.clone();
    thread::spawn(move || {
        thread::sleep(std::time::Duration::from_secs(2));
        let ready = fallback_app
            .state::<AppState>()
            .pin_runtime
            .lock_or_recover()
            .ready
            .contains(&fallback_id);
        if !ready {
            tracing::warn!(target: "dock_mapper::pin", pin_id = %fallback_id, "贴图解码握手超时，显示窗口以便诊断");
            if let Some(window) = fallback_app.get_webview_window(&fallback_id) {
                let _ = window.show();
            }
        }
    });
    if close_source_overlay {
        close_overlay_impl(&app);
    }
    Ok(id)
}

#[tauri::command]
pub async fn pin_image(
    app: AppHandle,
    config_state: State<'_, crate::AppState>,
    image_id: String,
) -> Result<String, String> {
    let data = config_state.images.take(&image_id)?;
    pin_image_impl(app, data, true)
}

#[tauri::command]
pub fn get_pin_image(state: State<AppState>, id: String) -> Result<tauri::ipc::Response, String> {
    state
        .pin_runtime
        .lock_or_recover()
        .data
        .get(&id)
        .cloned()
        .map(|data| tauri::ipc::Response::new(data.as_ref().to_vec()))
        .ok_or_else(|| "No pinned image is available".into())
}

#[tauri::command]
pub fn pin_image_ready(app: AppHandle, id: String) -> Result<bool, String> {
    let state = app.state::<AppState>();
    let mut runtime = state.pin_runtime.lock_or_recover();
    if !runtime.data.contains_key(&id) {
        return Err("贴图数据不存在".into());
    }
    runtime.ready.insert(id.clone());
    drop(runtime);
    let window = app
        .get_webview_window(&id)
        .ok_or_else(|| "贴图窗口不存在".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn get_pin_options(state: State<AppState>, id: String) -> Result<PinOptions, String> {
    state
        .pin_runtime
        .lock_or_recover()
        .options
        .get(&id)
        .copied()
        .ok_or_else(|| "贴图窗口不存在".into())
}

#[tauri::command]
pub fn update_pin_options(
    app: AppHandle,
    id: String,
    opacity: f64,
    locked: bool,
) -> Result<PinOptions, String> {
    let options = normalized_pin_options(opacity, locked);
    let state = app.state::<AppState>();
    let mut runtime = state.pin_runtime.lock_or_recover();
    if !runtime.options.contains_key(&id) { return Err("贴图窗口不存在".into()); }
    runtime.options.insert(id.clone(), options);
    drop(runtime);
    app.get_webview_window(&id).ok_or_else(|| "贴图窗口不存在".to_string())?;
    Ok(options)
}

#[tauri::command]
pub fn close_pin_window(app: AppHandle, id: String) {
    release_pin_runtime(&app, &id, true);
}

#[tauri::command]
pub fn scale_pin_window(
    app: AppHandle,
    id: String,
    anchor_x: f64,
    anchor_y: f64,
    factor: f64,
) -> Result<bool, String> {
    let window = app
        .get_webview_window(&id)
        .ok_or_else(|| "贴图窗口不存在".to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?;
    let (max_width, max_height) = monitor
        .map(|item| {
            (
                item.size().width.saturating_sub(40),
                item.size().height.saturating_sub(40),
            )
        })
        .unwrap_or((3840, 2160));
    let next_width = ((size.width as f64 * factor).round() as u32).clamp(60, max_width.max(60));
    let next_height = ((size.height as f64 * factor).round() as u32).clamp(60, max_height.max(60));
    let x = position.x
        + ((size.width as i64 - next_width as i64) as f64 * anchor_x.clamp(0.0, 1.0)).round()
            as i32;
    let y = position.y
        + ((size.height as i64 - next_height as i64) as f64 * anchor_y.clamp(0.0, 1.0)).round()
            as i32;
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    window
        .set_size(tauri::PhysicalSize::new(next_width, next_height))
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn open_url(url: String) -> Result<bool, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only HTTP(S) URLs are allowed".into());
    }
    let status = Command::new("rundll32.exe")
        .arg("url.dll,FileProtocolHandler")
        .arg(&url)
        .status();
    status.map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pin_requires_a_confirmed_selection_png() {
        let state = create_state();
        assert!(confirmed_image(&state).is_err());

        *state.confirmed_png.lock_or_recover() = Some(vec![1, 2, 3].into());
        assert_eq!(
            confirmed_image(&state).expect("confirmed PNG"),
            Arc::<[u8]>::from(vec![1, 2, 3])
        );
    }

    #[test]
    fn uses_gdi_when_dxgi_returns_an_error() {
        let mut reason = None;
        let (frame, backend) = capture_with_gdi_fallback(Err("access lost".into()), |error| {
            reason = Some(error.to_string());
            Ok::<_, String>(42)
        })
        .unwrap();
        assert_eq!(frame, 42);
        assert_eq!(backend, "gdi");
        assert_eq!(reason.as_deref(), Some("access lost"));
    }

    #[test]
    fn memory_bmp_is_top_down_bgra() {
        let bmp = bmp_from_bgra(1, 1, &[0x56, 0x34, 0x12, 0xff]).expect("BMP");
        assert_eq!(&bmp[..2], b"BM");
        assert_eq!(i32::from_le_bytes(bmp[22..26].try_into().unwrap()), -1);
        assert_eq!(&bmp[54..58], &[0x56, 0x34, 0x12, 0xff]);
    }

    #[test]
    fn pin_runtime_opacity_is_clamped_without_persisting_state() {
        assert_eq!(normalized_pin_options(0.05, true).opacity, 0.2);
        assert_eq!(normalized_pin_options(1.5, false).opacity, 1.0);
        assert!(normalized_pin_options(0.75, true).locked);
    }

    #[test]
    fn first_pin_is_centered_and_following_pins_use_distinct_slots() {
        let screen = Rect {
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
        };
        let first = pin_window_layout(screen, 400.0, 300.0, 0);
        let second = pin_window_layout(screen, 400.0, 300.0, 1);
        assert_eq!((first.x, first.y), (760.0, 390.0));
        assert_ne!((first.x, first.y), (second.x, second.y));
        assert_eq!(
            ((second.x - first.x).abs(), (second.y - first.y).abs()),
            (PIN_CASCADE_STEP, PIN_CASCADE_STEP)
        );
    }

    #[test]
    fn pin_layout_wraps_inside_negative_monitor_bounds() {
        let screen = Rect {
            x: -1920.0,
            y: -120.0,
            width: 1280.0,
            height: 720.0,
        };
        for slot in 0..80 {
            let layout = pin_window_layout(screen, 700.0, 500.0, slot);
            assert!(layout.x >= screen.x + PIN_WINDOW_MARGIN);
            assert!(layout.y >= screen.y + PIN_WINDOW_MARGIN);
            assert!(layout.x + layout.width <= screen.x + screen.width - PIN_WINDOW_MARGIN + 0.5);
            assert!(layout.y + layout.height <= screen.y + screen.height - PIN_WINDOW_MARGIN + 0.5);
        }
    }

    #[test]
    fn oversized_pin_uses_the_only_safe_position() {
        let screen = Rect {
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
        };
        let first = pin_window_layout(screen, 1880.0, 1040.0, 0);
        let later = pin_window_layout(screen, 1880.0, 1040.0, 9);
        assert_eq!(first, later);
        assert_eq!((first.x, first.y), (20.0, 20.0));
    }

    #[test]
    fn logical_pin_geometry_respects_mixed_dpi_and_negative_origins() {
        let physical = logical_pin_to_physical(
            Rect {
                x: -1280.0,
                y: 0.0,
                width: 1280.0,
                height: 720.0,
            },
            -1920,
            0,
            1.5,
            PinWindowLayout {
                x: -1000.0,
                y: 100.0,
                width: 300.0,
                height: 200.0,
            },
        );
        assert_eq!(physical, (-1500, 150, 450, 300));
    }

    #[test]
    fn releasing_one_pin_keeps_others_and_reuses_only_its_slot() {
        let mut runtime = PinRuntimeState::default();
        let first_slot = runtime.reserve("pin-1".into(), Arc::<[u8]>::from(vec![1]), 7);
        let second_slot = runtime.reserve("pin-2".into(), Arc::<[u8]>::from(vec![2]), 7);
        let other_monitor_slot = runtime.reserve("pin-3".into(), Arc::<[u8]>::from(vec![3]), 8);
        assert_eq!((first_slot, second_slot, other_monitor_slot), (0, 1, 0));
        assert_eq!(runtime.latest(), Some("pin-3"));

        runtime.ready.insert("pin-1".into());
        runtime.remove("pin-1");
        assert!(!runtime.data.contains_key("pin-1"));
        assert!(!runtime.options.contains_key("pin-1"));
        assert!(!runtime.placements.contains_key("pin-1"));
        assert!(runtime.data.contains_key("pin-2"));
        runtime.remove("pin-3");
        assert_eq!(runtime.latest(), Some("pin-2"));

        let reused = runtime.reserve("pin-4".into(), Arc::<[u8]>::from(vec![4]), 7);
        assert_eq!(reused, 0);
        assert_eq!(runtime.latest(), Some("pin-4"));
        runtime.remove("pin-4");
        runtime.remove("pin-2");
        assert_eq!(runtime.latest(), None);
    }
}
