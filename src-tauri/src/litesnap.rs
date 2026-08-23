use std::{
    collections::{HashMap, HashSet},
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

use image::RgbaImage;
use screenshots::Screen;
use serde::{Deserialize, Serialize};
use tauri::http::{Request, Response, StatusCode};
use tauri::Monitor;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

mod clipboard;
mod shortcut;
#[path = "litesnap/windows.rs"]
mod window_candidates;

trait DiagnosticMutex<T> {
    fn lock_or_recover(&self) -> MutexGuard<'_, T>;
}

impl<T> DiagnosticMutex<T> for Mutex<T> {
    fn lock_or_recover(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|poisoned| {
            tracing::error!(target: "dock_mapper::state", "recovering poisoned LiteSnap state");
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
}

#[derive(Clone, Debug)]
struct CaptureTiming {
    generation: u64,
    started: Instant,
    native_ready_ms: u128,
    webview_ready_ms: Option<u128>,
}

pub struct AppState {
    capture: Mutex<Option<CaptureData>>,
    pin_data: Mutex<HashMap<String, Vec<u8>>>,
    pin_generation: AtomicU64,
    pin_ready: Mutex<HashSet<String>>,
    pin_options: Mutex<HashMap<String, PinOptions>>,
    // Ctrl+2 deliberately consumes only a PNG exported by the editor. Keeping
    // it separate from the frozen full-screen capture prevents accidental
    // pinning before the user has confirmed a selection.
    confirmed_png: Mutex<Option<Vec<u8>>>,
    registered_shortcut: Mutex<Option<String>>,
    registered_pin_shortcut: Mutex<Option<String>>,
    overlay_ready: AtomicBool,
    active_overlay: Mutex<Option<String>>,
    capture_in_progress: AtomicBool,
    capture_generation: AtomicU64,
    capture_timings: Mutex<Vec<CaptureTiming>>,
    dxgi_capture: Mutex<crate::dxgi_capture::CaptureManager>,
}

// Tauri's URI protocol is registered before managed state is available. Keep
// only the current frozen frame here; the generation in the URL prevents a
// stale WebView request from observing a newer screenshot.
static URI_CAPTURE: LazyLock<Mutex<Option<CaptureData>>> = LazyLock::new(|| Mutex::new(None));

pub fn create_state() -> AppState {
    AppState {
        capture: Mutex::new(None),
        pin_data: Mutex::new(HashMap::new()),
        pin_generation: AtomicU64::new(0),
        pin_ready: Mutex::new(HashSet::new()),
        pin_options: Mutex::new(HashMap::new()),
        confirmed_png: Mutex::new(None),
        registered_shortcut: Mutex::new(None),
        registered_pin_shortcut: Mutex::new(None),
        overlay_ready: AtomicBool::new(false),
        active_overlay: Mutex::new(None),
        capture_in_progress: AtomicBool::new(false),
        capture_generation: AtomicU64::new(0),
        capture_timings: Mutex::new(Vec::with_capacity(20)),
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
    shortcut::register_capture(app, &shortcuts.shortcut)
        .map_err(|error| format!("注册 {} 截图快捷键失败：{error}", shortcuts.shortcut))?;
    shortcut::register_pin(app, &shortcuts.pin_shortcut)
        .map_err(|error| format!("注册 {} 贴图快捷键失败：{error}", shortcuts.pin_shortcut))?;
    Ok(())
}

pub fn start_capture(app: &AppHandle) {
    handle_start_capture(app);
}

#[tauri::command]
pub fn start_screenshot(app: AppHandle) {
    handle_start_capture(&app);
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
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinOptions {
    opacity: f64,
    locked: bool,
}

impl Default for PinOptions {
    fn default() -> Self {
        Self {
            opacity: 1.0,
            locked: false,
        }
    }
}

fn normalized_pin_options(opacity: f64, locked: bool) -> PinOptions {
    PinOptions {
        opacity: opacity.clamp(0.2, 1.0),
        locked,
    }
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

fn bmp_from_bgra(width: u32, height: u32, bgra: &[u8]) -> Result<Arc<[u8]>, String> {
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

fn bmp_from_rgba(image: &RgbaImage) -> Result<Arc<[u8]>, String> {
    let mut bgra = image.as_raw().clone();
    for pixel in bgra.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    bmp_from_bgra(image.width(), image.height(), &bgra)
}

fn image_is_blank(image: &RgbaImage) -> bool {
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

fn active_screen(app: &AppHandle) -> Result<Screen, String> {
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

fn screen_rect(screen: &Screen) -> Rect {
    let info = screen.display_info;
    Rect {
        x: info.x as f64,
        y: info.y as f64,
        width: info.width as f64,
        height: info.height as f64,
    }
}

fn rect_distance_squared(rect: Rect, point: (f64, f64)) -> f64 {
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

fn select_screen_containing_point(screens: &[Screen], point: (f64, f64)) -> Option<Screen> {
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

fn nearest_screen(screens: &[Screen], point: (f64, f64)) -> Option<Screen> {
    screens
        .iter()
        .min_by(|left, right| {
            rect_distance_squared(screen_rect(left), point)
                .total_cmp(&rect_distance_squared(screen_rect(right), point))
        })
        .copied()
}

fn screen_geometry_score(screen: &Screen, logical: &Rect, physical: &Rect) -> f64 {
    let info = screen_rect(screen);
    let score = |expected: &Rect| {
        let position = (info.x - expected.x).abs() + (info.y - expected.y).abs();
        let size = (info.width - expected.width).abs() + (info.height - expected.height).abs();
        position + size
    };
    score(logical).min(score(physical))
}

#[cfg(target_os = "windows")]
fn monitor_screen_score(screen: &Screen, monitor: &Monitor) -> f64 {
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

fn capture_active_screen(app: &AppHandle) -> Result<CaptureData, String> {
    let span = tracing::info_span!(target: "dock_mapper::capture", "screenshot_capture");
    let _entered = span.enter();
    let screen = active_screen(app)?;
    let info = screen.display_info;
    let (bmp, image_width, image_height, bounds, physical_origin_x, physical_origin_y) = {
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
            .capture(rect, 20);
        let (bmp, image_width, image_height) = match dxgi {
            Ok(frame) => (
                bmp_from_bgra(frame.width, frame.height, &frame.bytes)?,
                frame.width,
                frame.height,
            ),
            Err(error) => {
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
                (bmp_from_rgba(&image)?, width, height)
            }
        };
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
    })
}

fn overlay_label(capture: &CaptureData) -> String {
    format!("overlay-{}", capture.screen_id)
}

fn active_overlay_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.state::<AppState>()
        .active_overlay
        .lock()
        .ok()?
        .as_deref()
        .and_then(|label| app.get_webview_window(label))
}

fn build_overlay_window(
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
        WebviewUrl::App("litesnap.html?view=overlay".into()),
    )
    .title("LiteSnap")
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

fn open_overlay(app: &AppHandle, capture: &CaptureData) -> Result<(), String> {
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
        #[cfg(target_os = "windows")]
        if let Some(window) = app.get_webview_window(&label) {
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
    }
    *app.state::<AppState>().active_overlay.lock_or_recover() = Some(label.clone());
    if app.get_webview_window(&label).is_none() {
        return Err("Capture overlay is unavailable".into());
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

fn record_capture_timing(
    app: &AppHandle,
    generation: u64,
    started: Instant,
    native_ready_ms: u128,
) {
    let state = app.state::<AppState>();
    let mut timings = state.capture_timings.lock_or_recover();
    timings.push(CaptureTiming {
        generation,
        started,
        native_ready_ms,
        webview_ready_ms: None,
    });
    if timings.len() > 20 {
        timings.remove(0);
    }
}

fn prewarm_overlay(app: &AppHandle) {
    if let Ok(screens) = Screen::all() {
        for screen in screens {
            let info = screen.display_info;
            let label = format!("overlay-{}", info.id);
            if app.get_webview_window(&label).is_some() {
                continue;
            }
            let result = build_overlay_window(
                app,
                &label,
                info.x as f64,
                info.y as f64,
                info.width as f64,
                info.height as f64,
            );
            if let Err(error) = result {
                tracing::warn!(target: "dock_mapper::capture", %label, %error, "Unable to prewarm capture overlay");
                continue;
            }
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window(&label) {
                if let Ok(monitors) = app.available_monitors() {
                    if let Some(monitor) = monitors.into_iter().min_by(|left, right| {
                        monitor_screen_score(&screen, left)
                            .total_cmp(&monitor_screen_score(&screen, right))
                    }) {
                        let _ = window.set_position(tauri::PhysicalPosition::new(
                            monitor.position().x,
                            monitor.position().y,
                        ));
                        let _ = window.set_size(tauri::PhysicalSize::new(
                            monitor.size().width,
                            monitor.size().height,
                        ));
                    }
                }
            }
        }
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
        WebviewUrl::App(format!("litesnap.html?view=pin&id={id}").into()),
    )
    .title("LiteSnap")
    .position(x, y)
    .inner_size(width, height)
    .min_inner_size(60.0, 60.0)
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .resizable(true)
    .always_on_top(true)
    .visible(false)
    .build()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

fn show_capture_error(app: &AppHandle, detail: &str) {
    tracing::error!(target: "dock_mapper::capture", %detail, "LiteSnap capture failed");
    let _ = app.emit("capture-error", detail.to_string());
    let _ = rfd::MessageDialog::new()
        .set_title("Cannot capture screen")
        .set_description(format!(
            "LiteSnap could not capture the screen. Check Screen Recording permission, fully quit LiteSnap, and open it again.\n\n{detail}"
        ))
        .set_level(rfd::MessageLevel::Error)
        .show();
}

fn handle_start_capture(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.capture_in_progress.swap(true, Ordering::SeqCst) {
        return;
    }
    // A shortcut can arrive while the previous WebView is still painting
    // (most visible on the first Windows launch). Hide it before the native
    // capture so LiteSnap never captures its own transparent surface together
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
        let result = capture_active_screen(&worker_app);
        let native_ready_ms = started.elapsed().as_millis();
        let ui_app = worker_app.clone();
        if let Err(error) = worker_app.run_on_main_thread(move || {
            match result {
                Ok(capture) => {
                    *ui_app.state::<AppState>().capture.lock_or_recover() = Some(capture.clone());
                    *URI_CAPTURE.lock_or_recover() = Some(capture.clone());
                    record_capture_timing(&ui_app, capture.generation, started, native_ready_ms);
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

fn hide_overlay_for_commit(app: &AppHandle) {
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

fn finish_overlay_commit(app: &AppHandle) {
    *app.state::<AppState>().capture.lock_or_recover() = None;
}

fn restore_overlay_after_commit_failure(app: &AppHandle) {
    if app.state::<AppState>().capture.lock_or_recover().is_some() {
        if let Some(window) = active_overlay_window(app) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn close_overlay_impl(app: &AppHandle) {
    hide_overlay_for_commit(app);
    finish_overlay_commit(app);
}

#[tauri::command]
pub fn copy_text(value: String) -> Result<bool, String> {
    clipboard::write_text(value)?;
    Ok(true)
}

fn remember_confirmed_image(app: &AppHandle, data: &[u8]) {
    *app.state::<AppState>().confirmed_png.lock_or_recover() = Some(data.to_vec());
}

fn confirmed_image(state: &AppState) -> Result<Vec<u8>, String> {
    state
        .confirmed_png
        .lock_or_recover()
        .clone()
        .ok_or_else(|| "没有已确认的选区截图，请先按 Ctrl+1 框选并确认。".to_string())
}

fn pin_confirmed_image(app: &AppHandle) -> Result<bool, String> {
    let data = confirmed_image(&app.state::<AppState>())?;
    pin_image_impl(app.clone(), data).map(|_| true)
}

pub fn update_capture_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    shortcut::register_capture(app, shortcut)
}

pub fn update_pin_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    shortcut::register_pin(app, shortcut)
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
            "Screenshot rendered"
        );
    }
    drop(timings);
    show_capture_overlay(app, Some(generation), Some(label))
}

#[tauri::command]
pub fn check_screen_permission() -> serde_json::Value {
    serde_json::json!({ "granted": true, "status": "granted" })
}

#[tauri::command]
pub fn copy_image(
    app: AppHandle,
    config_state: State<'_, crate::AppState>,
    image_id: String,
) -> Result<bool, String> {
    let data = config_state.images.get(&image_id)?;
    config_state.images.remove(&image_id);
    hide_overlay_for_commit(&app);
    if let Err(error) = clipboard::write_png(&data) {
        restore_overlay_after_commit_failure(&app);
        return Err(error);
    }
    remember_confirmed_image(&app, &data);
    finish_overlay_commit(&app);
    Ok(true)
}

#[tauri::command]
pub fn save_image(
    app: AppHandle,
    config_state: State<'_, crate::AppState>,
    image_id: String,
) -> Result<bool, String> {
    let data = config_state.images.get(&image_id)?;
    config_state.images.remove(&image_id);
    hide_overlay_for_commit(&app);
    if let Err(error) = clipboard::write_png(&data) {
        restore_overlay_after_commit_failure(&app);
        return Err(error);
    }
    remember_confirmed_image(&app, &data);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let screenshot_config = match config_state.config.lock() {
        Ok(config) => config.screenshot_config.clone(),
        Err(_) => {
            restore_overlay_after_commit_failure(&app);
            return Err("配置状态已损坏".into());
        }
    };
    let mut dialog = rfd::FileDialog::new()
        .set_title("Save Screenshot")
        .set_file_name(format!("{}-{stamp}.png", screenshot_config.filename_prefix))
        .add_filter("PNG Image", &["png"]);
    if let Some(directory) = screenshot_config.save_directory {
        let directory = PathBuf::from(directory);
        if directory.is_dir() {
            dialog = dialog.set_directory(directory);
        }
    }
    let Some(path) = dialog.save_file() else {
        restore_overlay_after_commit_failure(&app);
        return Ok(false);
    };
    if let Err(error) = fs::write(path, data) {
        restore_overlay_after_commit_failure(&app);
        return Err(error.to_string());
    }
    finish_overlay_commit(&app);
    Ok(true)
}

fn pin_image_impl(app: AppHandle, data: Vec<u8>) -> Result<String, String> {
    // Reading the PNG header is enough to size the native window. Fully
    // decoding a large/long screenshot on Tauri's IPC thread can starve the
    // Windows event loop, which also prevents Cancel and the global shortcut
    // from being processed.
    let (pixel_width, pixel_height) = image::io::Reader::new(Cursor::new(&data))
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
    let screen_bounds = if let Some(capture) = capture.as_ref() {
        capture.bounds
    } else {
        let info = active_screen(&app)?.display_info;
        Rect {
            x: info.x as f64,
            y: info.y as f64,
            width: info.width as f64,
            height: info.height as f64,
        }
    };
    let max_width = (screen_bounds.width - 40.0).max(160.0);
    let max_height = (screen_bounds.height - 40.0).max(160.0);
    let fit = (max_width / natural_width)
        .min(max_height / natural_height)
        .min(1.0);
    let window_width = (natural_width * fit).max(60.0);
    let window_height = (natural_height * fit).max(60.0);
    let window_x = screen_bounds.x + (screen_bounds.width - window_width) / 2.0;
    let window_y = screen_bounds.y + (screen_bounds.height - window_height) / 2.0;
    #[cfg(target_os = "windows")]
    let physical_geometry = capture.as_ref().map(|capture| {
        let scale = capture.scale_factor.max(1.0);
        (
            capture.physical_origin_x + ((window_x - capture.bounds.x) * scale).round() as i32,
            capture.physical_origin_y + ((window_y - capture.bounds.y) * scale).round() as i32,
            (window_width * scale).round().max(1.0) as u32,
            (window_height * scale).round().max(1.0) as u32,
        )
    });
    remember_confirmed_image(&app, &data);
    let id = format!(
        "pin-{}",
        app.state::<AppState>()
            .pin_generation
            .fetch_add(1, Ordering::SeqCst)
            + 1
    );
    app.state::<AppState>()
        .pin_data
        .lock_or_recover()
        .insert(id.clone(), data);
    app.state::<AppState>()
        .pin_options
        .lock_or_recover()
        .insert(id.clone(), PinOptions::default());
    build_pin_window(&app, &id, window_x, window_y, window_width, window_height)?;

    let window = app
        .get_webview_window(&id)
        .ok_or_else(|| "Pin window is unavailable".to_string())?;
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
                .set_position(tauri::LogicalPosition::new(window_x, window_y))
                .map_err(|error| error.to_string())?;
            window
                .set_size(tauri::LogicalSize::new(window_width, window_height))
                .map_err(|error| error.to_string())?;
        }
        let _ = window.emit("pin-image-updated", &id);
    }
    let fallback_app = app.clone();
    let fallback_id = id.clone();
    thread::spawn(move || {
        thread::sleep(std::time::Duration::from_secs(2));
        let ready = fallback_app
            .state::<AppState>()
            .pin_ready
            .lock_or_recover()
            .contains(&fallback_id);
        if !ready {
            tracing::warn!(target: "dock_mapper::pin", pin_id = %fallback_id, "贴图解码握手超时，显示窗口以便诊断");
            if let Some(window) = fallback_app.get_webview_window(&fallback_id) {
                let _ = window.show();
            }
        }
    });
    close_overlay_impl(&app);
    Ok(id)
}

#[tauri::command]
pub async fn pin_image(
    app: AppHandle,
    config_state: State<'_, crate::AppState>,
    image_id: String,
) -> Result<String, String> {
    let data = config_state.images.get(&image_id)?;
    config_state.images.remove(&image_id);
    pin_image_impl(app, data)
}

#[tauri::command]
pub fn get_pin_image(state: State<AppState>, id: String) -> Result<tauri::ipc::Response, String> {
    state
        .pin_data
        .lock_or_recover()
        .get(&id)
        .cloned()
        .map(tauri::ipc::Response::new)
        .ok_or_else(|| "No pinned image is available".into())
}

#[tauri::command]
pub fn pin_image_ready(app: AppHandle, id: String) -> Result<bool, String> {
    let state = app.state::<AppState>();
    if !state.pin_data.lock_or_recover().contains_key(&id) {
        return Err("贴图数据不存在".into());
    }
    state.pin_ready.lock_or_recover().insert(id.clone());
    let window = app
        .get_webview_window(&id)
        .ok_or_else(|| "贴图窗口不存在".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn get_pin_options(state: State<AppState>, id: String) -> Result<PinOptions, String> {
    state
        .pin_options
        .lock_or_recover()
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
    let mut values = state.pin_options.lock_or_recover();
    if !values.contains_key(&id) {
        return Err("贴图窗口不存在".into());
    }
    values.insert(id.clone(), options);
    drop(values);
    let window = app
        .get_webview_window(&id)
        .ok_or_else(|| "贴图窗口不存在".to_string())?;
    window
        .set_resizable(!locked)
        .map_err(|error| error.to_string())?;
    Ok(options)
}

#[tauri::command]
pub fn copy_pin_image(state: State<AppState>, id: String) -> Result<bool, String> {
    let data = state
        .pin_data
        .lock_or_recover()
        .get(&id)
        .cloned()
        .ok_or_else(|| "贴图数据不存在".to_string())?;
    clipboard::write_png(&data)?;
    Ok(true)
}

#[tauri::command]
pub fn save_pin_image(state: State<AppState>, id: String) -> Result<bool, String> {
    let data = state
        .pin_data
        .lock_or_recover()
        .get(&id)
        .cloned()
        .ok_or_else(|| "贴图数据不存在".to_string())?;
    let Some(path) = rfd::FileDialog::new()
        .set_title("保存贴图")
        .set_file_name("DockMapper-pin.png")
        .add_filter("PNG Image", &["png"])
        .save_file()
    else {
        return Ok(false);
    };
    fs::write(path, data).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn close_pin_window(app: AppHandle, id: String) {
    if let Some(window) = app.get_webview_window(&id) {
        let _ = window.destroy();
    }
    app.state::<AppState>()
        .pin_data
        .lock_or_recover()
        .remove(&id);
    app.state::<AppState>().pin_ready.lock_or_recover().remove(&id);
    app.state::<AppState>()
        .pin_options
        .lock_or_recover()
        .remove(&id);
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

        *state.confirmed_png.lock_or_recover() = Some(vec![1, 2, 3]);
        assert_eq!(
            confirmed_image(&state).expect("confirmed PNG"),
            vec![1, 2, 3]
        );
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
}
