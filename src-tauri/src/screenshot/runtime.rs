use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    shortcuts: Vec<ShortcutRuntimeStatus>,
    recent_capture_backend: Option<String>,
    recent_capture_ms: Option<u64>,
    capture_p95_ms: Option<u64>,
    dxgi_fallback_count: usize,
    pin_count: usize,
}

// Tauri's URI protocol is registered before managed state is available. Keep
// only the current frozen frame here; the generation in the URL prevents a
// stale WebView request from observing a newer screenshot.
pub(super) static URI_CAPTURE: LazyLock<Mutex<Option<CaptureData>>> =
    LazyLock::new(|| Mutex::new(None));

pub fn runtime_status(app: &AppHandle) -> Result<RuntimeStatus, String> {
    let state = app.state::<AppState>();
    let config = app
        .state::<crate::AppState>()
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())?
        .screenshot_config
        .clone();
    let shortcuts = shortcut::statuses(app, &config)?;

    let timings = state.capture_timings.lock_or_recover();
    let latest = timings.last();
    let mut completed = timings
        .iter()
        .filter_map(|timing| timing.webview_ready_ms)
        .collect::<Vec<_>>();
    completed.sort_unstable();
    let capture_p95_ms = (!completed.is_empty()).then(|| {
        let index = ((completed.len() as f64 * 0.95).ceil() as usize)
            .saturating_sub(1)
            .min(completed.len() - 1);
        completed[index].min(u64::MAX as u128) as u64
    });
    let dxgi_fallback_count = state.dxgi_fallback_count.load(Ordering::Relaxed) as usize;
    let recent_capture_backend = latest.map(|timing| timing.backend.to_string());
    let recent_capture_ms = latest
        .and_then(|timing| timing.webview_ready_ms.or(Some(timing.native_ready_ms)))
        .map(|value| value.min(u64::MAX as u128) as u64);
    drop(timings);

    let pin_count = state.pin_runtime.lock_or_recover().data.len();
    Ok(RuntimeStatus {
        shortcuts,
        recent_capture_backend,
        recent_capture_ms,
        capture_p95_ms,
        dxgi_fallback_count,
        pin_count,
    })
}
