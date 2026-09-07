//! Runtime for the unified key visualizer and its optional pointer effects.
use crate::{config, key_visualizer, AppState};
use serde::Serialize;
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Screen {
    pub label: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

#[derive(Clone, Serialize)]
pub struct VisualizerEffectsStatus {
    pub enabled: bool,
    pub suspended: bool,
    pub generation: u64,
    pub phase: String,
    pub error: Option<String>,
    pub config: config::KeyVisualizerConfig,
    pub screens: Vec<Screen>,
    pub locks: Option<LockState>,
}

impl Default for VisualizerEffectsStatus {
    fn default() -> Self {
        Self {
            enabled: false,
            suspended: false,
            generation: 0,
            phase: "off".into(),
            error: None,
            config: config::KeyVisualizerConfig::default(),
            screens: vec![],
            locks: None,
        }
    }
}

#[derive(Default)]
pub struct VisualizerEffectsRuntime {
    state: Mutex<VisualizerEffectsStatus>,
    pub(crate) operation: Mutex<()>,
    ready: Mutex<std::collections::HashSet<String>>,
    started: Mutex<Option<Instant>>,
    capture_token: Mutex<u64>,
}

pub fn snapshot(app: &AppHandle) -> VisualizerEffectsStatus {
    app.state::<VisualizerEffectsRuntime>()
        .state
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

fn publish(app: &AppHandle) {
    let status = snapshot(app);
    if let Err(error) = app.emit("key-visualizer-effects-status", &status) {
        tracing::error!(%error, "发布按键展示状态失败");
    }
}

pub fn effective_key_config(
    config: &config::KeyVisualizerConfig,
    status: &VisualizerEffectsStatus,
) -> config::KeyVisualizerConfig {
    let mut value = config.clone();
    value.enabled = status.enabled
        && (config.show_modifiers
            || config.show_combinations
            || config.show_characters
            || config.show_other
            || config.lock_keys);
    if status.suspended {
        value.enabled = false;
    }
    value
}

pub fn effective_keys(
    app: &AppHandle,
    ordinary: &config::KeyVisualizerConfig,
) -> config::KeyVisualizerConfig {
    effective_key_config(ordinary, &snapshot(app))
}

pub fn needs_input(app: &AppHandle) -> bool {
    let s = snapshot(app);
    s.enabled
        && !s.suspended
        && (s.config.show_modifiers
            || s.config.show_combinations
            || s.config.show_characters
            || s.config.show_other
            || s.config.clicks
            || s.config.highlight
            || s.config.lock_keys)
}

fn apply_keys(app: &AppHandle) -> Result<(), String> {
    let config = snapshot(app).config;
    app.state::<key_visualizer::KeyVisualizerRuntime>()
        .apply(app, &config)
}

fn screen_specs(app: &AppHandle) -> Result<Vec<Screen>, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    if monitors.is_empty() {
        return Err("未检测到显示器".into());
    }
    Ok(monitors
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| Screen {
            label: format!("key-visualizer-effect-{index}"),
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
            scale: monitor.scale_factor(),
        })
        .collect())
}

fn close_windows(app: &AppHandle) -> Result<(), String> {
    let mut errors = vec![];
    for (label, window) in app.webview_windows() {
        if label.starts_with("key-visualizer-effect-") {
            if let Err(error) = window.destroy() {
                errors.push(format!("关闭鼠标效果失败：{error}"));
            }
        }
    }
    app.state::<VisualizerEffectsRuntime>()
        .ready
        .lock()
        .map_err(|_| "按键展示窗口状态已损坏")?
        .clear();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("；"))
    }
}

fn prepare_windows(app: &AppHandle) -> Result<(), String> {
    let status = snapshot(app);
    if !status.enabled || !(status.config.clicks || status.config.highlight) {
        close_windows(app)?;
        app.state::<VisualizerEffectsRuntime>()
            .state
            .lock()
            .map_err(|_| "按键展示状态已损坏")?
            .screens
            .clear();
        return sync_visibility(app);
    }
    let screens = screen_specs(app)?;
    if status.screens != screens {
        close_windows(app)?;
        let runtime = app.state::<VisualizerEffectsRuntime>();
        let mut state = runtime.state.lock().map_err(|_| "按键展示状态已损坏")?;
        state.generation += 1;
        state.screens = screens.clone();
        state.phase = "starting".into();
        *runtime.started.lock().map_err(|_| "按键展示状态已损坏")? = Some(Instant::now());
    }
    for screen in &screens {
        if app.get_webview_window(&screen.label).is_none() {
            let runtime = app.state::<VisualizerEffectsRuntime>();
            if runtime
                .ready
                .lock()
                .map_err(|_| "按键展示窗口状态已损坏")?
                .remove(&screen.label)
            {
                runtime
                    .state
                    .lock()
                    .map_err(|_| "按键展示状态已损坏")?
                    .generation += 1;
            }
            let window = WebviewWindowBuilder::new(
                app,
                &screen.label,
                WebviewUrl::App("key-visualizer-effects.html".into()),
            )
            .title("DockMapper 鼠标效果")
            .visible(false)
            .focused(false)
            .focusable(false)
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .build()
            .map_err(|e| format!("创建鼠标效果窗口失败：{e}"))?;
            window
                .set_ignore_cursor_events(true)
                .map_err(|e| format!("启用鼠标穿透失败：{e}"))?;
            window
                .set_position(PhysicalPosition::new(screen.x, screen.y))
                .map_err(|e| e.to_string())?;
            window
                .set_size(PhysicalSize::new(screen.width, screen.height))
                .map_err(|e| e.to_string())?;
        }
    }
    sync_visibility(app)
}

fn sync_visibility(app: &AppHandle) -> Result<(), String> {
    let runtime = app.state::<VisualizerEffectsRuntime>();
    let ready = runtime
        .ready
        .lock()
        .map_err(|_| "按键展示窗口状态已损坏")?
        .clone();
    let status = snapshot(app);
    if !status.enabled {
        *runtime.started.lock().map_err(|_| "按键展示状态已损坏")? = None;
    }
    let all_ready = status
        .screens
        .iter()
        .all(|screen| ready.contains(&screen.label))
        && app
            .state::<key_visualizer::KeyVisualizerRuntime>()
            .is_ready();
    for screen in &status.screens {
        if let Some(window) = app.get_webview_window(&screen.label) {
            if status.enabled && !status.suspended && all_ready {
                window.show()
            } else {
                window.hide()
            }
            .map_err(|e| format!("同步鼠标效果窗口失败：{e}"))?;
        }
    }
    if status.enabled && !all_ready {
        runtime
            .state
            .lock()
            .map_err(|_| "按键展示状态已损坏")?
            .phase = "starting".into();
        runtime
            .started
            .lock()
            .map_err(|_| "按键展示状态已损坏")?
            .get_or_insert_with(Instant::now);
    }
    if status.enabled && all_ready {
        runtime
            .state
            .lock()
            .map_err(|_| "按键展示状态已损坏")?
            .phase = "running".into();
        *runtime.started.lock().map_err(|_| "按键展示状态已损坏")? = None;
    }
    Ok(())
}

fn rollback(app: &AppHandle, error: String) -> String {
    let runtime = app.state::<VisualizerEffectsRuntime>();
    {
        let mut state = runtime.state.lock().unwrap_or_else(|e| e.into_inner());
        failed_session(&mut state, &error);
    }
    *runtime.started.lock().unwrap_or_else(|e| e.into_inner()) = None;
    let mut errors = vec![error];
    if let Err(error) = close_windows(app) {
        errors.push(error);
    }
    if let Err(error) = apply_keys(app) {
        errors.push(format!("恢复按键展示失败：{error}"));
    }
    let error = errors.join("；");
    runtime
        .state
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .error = Some(error.clone());
    publish(app);
    error
}

fn failed_session(state: &mut VisualizerEffectsStatus, error: &str) {
    state.enabled = false;
    state.generation += 1;
    state.phase = "off".into();
    state.screens.clear();
    state.locks = None;
    state.error = Some(error.into());
}

#[derive(Clone, Serialize)]
pub struct LockState {
    pub generation: u64,
    pub caps: bool,
    pub num: bool,
    pub timestamp_ms: u64,
}

#[derive(Clone, Serialize)]
pub struct MouseEffect {
    pub generation: u64,
    pub x: i32,
    pub y: i32,
    pub kind: &'static str,
    pub timestamp_ms: u64,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn mouse(app: &AppHandle, generation: u64, x: i32, y: i32, kind: &'static str) {
    let status = snapshot(app);
    if !accepts_event(&status, generation) {
        return;
    }
    if kind == "move" && !status.config.highlight {
        return;
    }
    if matches!(kind, "left" | "right" | "middle") && !status.config.clicks {
        return;
    }
    let effect = MouseEffect {
        generation,
        x,
        y,
        kind,
        timestamp_ms: now_ms(),
    };
    for screen in &status.screens {
        if let Err(error) = app.emit_to(&screen.label, "key-visualizer-mouse", &effect) {
            report_input_error(app, generation, format!("发送鼠标效果失败：{error}"));
        }
    }
}

fn accepts_event(status: &VisualizerEffectsStatus, generation: u64) -> bool {
    status.enabled && !status.suspended && status.generation == generation
}

pub fn lock_state(app: &AppHandle, generation: u64, caps: bool, num: bool) {
    let status = snapshot(app);
    if !accepts_event(&status, generation) || !status.config.lock_keys {
        return;
    }
    let value = LockState {
        generation,
        caps,
        num,
        timestamp_ms: now_ms(),
    };
    app.state::<VisualizerEffectsRuntime>()
        .state
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .locks = Some(value.clone());
    if let Err(error) = app.emit_to("key_visualizer", "key-visualizer-locks", value) {
        report_input_error(app, generation, format!("发送锁定键状态失败：{error}"));
    }
}

pub fn report_input_error(app: &AppHandle, generation: u64, error: String) {
    // The input thread must never wait for the UI thread (stop joins this thread).
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<VisualizerEffectsRuntime>();
        let Ok(_operation) = runtime.operation.lock() else {
            return;
        };
        if accepts_event(&snapshot(&app), generation) {
            rollback(&app, error);
        }
    });
}

#[tauri::command]
pub fn get_key_visualizer_effects_status(app: AppHandle) -> VisualizerEffectsStatus {
    snapshot(&app)
}

#[tauri::command]
pub async fn locate_key_visualizer_mouse(app: AppHandle) -> Result<(), String> {
    let state = snapshot(&app);
    if !state.enabled || state.suspended {
        return Err("请先启用按键展示，并结束截图".into());
    }
    if !state.config.highlight {
        return Err("请先启用鼠标高亮与定位".into());
    }
    let mut point = windows::Win32::Foundation::POINT::default();
    unsafe { windows::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut point) }
        .map_err(|e| e.to_string())?;
    mouse(&app, state.generation, point.x, point.y, "locate");
    Ok(())
}

#[tauri::command]
pub async fn key_visualizer_effects_ready(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<VisualizerEffectsStatus, String> {
    let runtime = app.state::<VisualizerEffectsRuntime>();
    let _operation = runtime
        .operation
        .lock()
        .map_err(|_| "按键展示操作状态已损坏")?;
    if !snapshot(&app)
        .screens
        .iter()
        .any(|screen| screen.label == window.label())
    {
        return Err("按键展示窗口会话已结束".into());
    }
    runtime
        .ready
        .lock()
        .map_err(|_| "按键展示窗口状态已损坏")?
        .insert(window.label().into());
    if let Err(error) = sync_visibility(&app) {
        return Err(rollback(&app, error));
    }
    publish(&app);
    Ok(snapshot(&app))
}

pub fn replace_config(
    app: &AppHandle,
    next: &config::KeyVisualizerConfig,
) -> Result<VisualizerEffectsStatus, String> {
    let runtime = app.state::<VisualizerEffectsRuntime>();
    let _operation = runtime
        .operation
        .lock()
        .map_err(|_| "按键展示操作状态已损坏")?;
    let previous = snapshot(app);
    {
        let mut state = runtime.state.lock().map_err(|_| "按键展示状态已损坏")?;
        state.config = next.clone();
        state.enabled = next.enabled;
        state.suspended = previous.suspended && next.enabled;
        state.generation += 1;
        state.error = None;
        state.locks = None;
        state.phase = if next.enabled { "starting" } else { "off" }.into();
    }
    if !next.enabled {
        *runtime
            .capture_token
            .lock()
            .map_err(|_| "截图暂停状态已损坏")? = 0;
    }
    if let Err(error) = prepare_windows(app)
        .and_then(|_| apply_keys(app))
        .and_then(|_| sync_visibility(app))
    {
        *runtime.state.lock().unwrap_or_else(|e| e.into_inner()) = previous;
        let restored = prepare_windows(app)
            .and_then(|_| apply_keys(app))
            .and_then(|_| sync_visibility(app));
        publish(app);
        return Err(match restored {
            Ok(()) => error,
            Err(restore) => format!("{error}；恢复旧按键展示失败：{restore}"),
        });
    }
    publish(app);
    Ok(snapshot(app))
}

pub fn retry(app: &AppHandle) -> Result<VisualizerEffectsStatus, String> {
    let config = snapshot(app).config;
    replace_config(app, &config)
}

pub fn suspend_for_capture(app: &AppHandle) -> Result<Option<u64>, String> {
    let runtime = app.state::<VisualizerEffectsRuntime>();
    let _operation = runtime
        .operation
        .lock()
        .map_err(|_| "按键展示操作状态已损坏")?;
    let previous = snapshot(app);
    let previous_token = *runtime
        .capture_token
        .lock()
        .map_err(|_| "截图暂停状态已损坏")?;
    let token = {
        let mut state = runtime.state.lock().map_err(|_| "按键展示状态已损坏")?;
        let mut active = runtime
            .capture_token
            .lock()
            .map_err(|_| "截图暂停状态已损坏")?;
        begin_capture_suspension(&mut state, &mut active)?
    };
    let Some(token) = token else {
        return Ok(None);
    };
    if previous.suspended {
        return Ok(Some(token));
    }
    if let Err(error) = apply_keys(app).and_then(|_| sync_visibility(app)) {
        *runtime.state.lock().unwrap_or_else(|e| e.into_inner()) = previous;
        *runtime
            .capture_token
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = previous_token;
        let restored = apply_keys(app).and_then(|_| sync_visibility(app));
        publish(app);
        return Err(match restored {
            Ok(()) => error,
            Err(restore) => format!("{error}；恢复截图前按键展示失败：{restore}"),
        });
    }
    publish(app);
    Ok(Some(token))
}

fn begin_capture_suspension(
    state: &mut VisualizerEffectsStatus,
    active: &mut u64,
) -> Result<Option<u64>, String> {
    if !state.enabled {
        return Ok(None);
    }
    if state.suspended {
        return if *active == 0 {
            Err("按键展示暂停代次已丢失，请重试".into())
        } else {
            Ok(Some(*active))
        };
    }
    state.suspended = true;
    state.generation += 1;
    state.locks = None;
    *active = state.generation;
    Ok(Some(*active))
}

pub fn resume_after_capture(app: &AppHandle, token: u64) -> Result<bool, String> {
    let runtime = app.state::<VisualizerEffectsRuntime>();
    let _operation = runtime
        .operation
        .lock()
        .map_err(|_| "按键展示操作状态已损坏")?;
    {
        let mut active = runtime
            .capture_token
            .lock()
            .map_err(|_| "截图暂停状态已损坏")?;
        if !consume_capture_token(&mut active, token) {
            return Ok(false);
        }
    }
    {
        let mut state = runtime.state.lock().map_err(|_| "按键展示状态已损坏")?;
        if !state.suspended {
            return Ok(false);
        }
        state.suspended = false;
        state.generation += 1;
        state.phase = if state.enabled { "starting" } else { "off" }.into();
    }
    if let Err(error) = prepare_windows(app)
        .and_then(|_| apply_keys(app))
        .and_then(|_| sync_visibility(app))
    {
        return Err(rollback(app, error));
    }
    publish(app);
    Ok(true)
}

fn consume_capture_token(active: &mut u64, token: u64) -> bool {
    if *active != token {
        return false;
    }
    *active = 0;
    true
}

pub fn initialize(app: &AppHandle) {
    let config = app
        .state::<AppState>()
        .config
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .key_visualizer_config
        .clone();
    if let Err(error) = replace_config(app, &config) {
        tracing::error!(target: "dock_mapper::key_visualizer", %error, "启动按键展示失败");
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if app.get_webview_window("main").is_none() {
                break;
            }
            let worker = app.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                let runtime = worker.state::<VisualizerEffectsRuntime>();
                let Ok(_operation) = runtime.operation.lock() else {
                    return;
                };
                if !snapshot(&worker).enabled {
                    return;
                }
                let timed_out = runtime
                    .started
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .is_some_and(|time| time.elapsed() > Duration::from_secs(8));
                if timed_out {
                    rollback(&worker, "鼠标效果窗口启动超时，请重试".into());
                    return;
                }
                let before = snapshot(&worker).generation;
                if let Err(error) = prepare_windows(&worker).and_then(|_| {
                    if snapshot(&worker).generation != before {
                        apply_keys(&worker)
                    } else {
                        Ok(())
                    }
                }) {
                    rollback(&worker, error);
                }
                publish(&worker);
            })
            .await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_preferences_start_disabled_with_visible_key_categories() {
        let config: config::AppConfig = serde_json::from_str("{}").unwrap();
        assert!(!config.key_visualizer_config.enabled);
        assert!(config.key_visualizer_config.show_characters);
        assert!(!VisualizerEffectsStatus::default().enabled);
    }

    #[test]
    fn screenshot_suspension_hides_keys_without_discarding_preferences() {
        let mut ordinary = config::KeyVisualizerConfig::default();
        ordinary.enabled = true;
        let mut status = VisualizerEffectsStatus {
            enabled: true,
            config: ordinary.clone(),
            ..Default::default()
        };
        assert!(effective_key_config(&ordinary, &status).enabled);
        status.suspended = true;
        let effective = effective_key_config(&ordinary, &status);
        assert!(!effective.enabled);
        assert!(effective.show_characters);
    }

    #[test]
    fn stale_screenshot_cannot_resume_a_newer_visualizer_session() {
        let mut active = 7;
        assert!(!consume_capture_token(&mut active, 6));
        assert_eq!(active, 7);
        assert!(consume_capture_token(&mut active, 7));
        assert_eq!(active, 0);
    }

    #[test]
    fn consecutive_screenshots_share_one_suspension_until_the_matching_resume() {
        let mut status = VisualizerEffectsStatus {
            enabled: true,
            generation: 4,
            ..Default::default()
        };
        let mut active = 0;
        let first = begin_capture_suspension(&mut status, &mut active).unwrap();
        let second = begin_capture_suspension(&mut status, &mut active).unwrap();
        assert_eq!(first, Some(5));
        assert_eq!(second, first);
        assert_eq!(status.generation, 5);
        assert!(!consume_capture_token(&mut active, 4));
        assert!(status.suspended);
        assert!(consume_capture_token(&mut active, 5));
    }

    #[test]
    fn old_mouse_events_cannot_reappear_after_stop_or_restart() {
        let mut status = VisualizerEffectsStatus {
            enabled: true,
            generation: 3,
            ..Default::default()
        };
        assert!(accepts_event(&status, 3));
        assert!(!accepts_event(&status, 2));
        status.suspended = true;
        assert!(!accepts_event(&status, 3));
        status.suspended = false;
        status.enabled = false;
        assert!(!accepts_event(&status, 3));
    }

    #[test]
    fn failed_start_hides_keys_and_invalidates_pending_effects() {
        let ordinary = config::KeyVisualizerConfig::default();
        let mut state = VisualizerEffectsStatus {
            enabled: true,
            generation: 8,
            phase: "starting".into(),
            ..Default::default()
        };
        failed_session(&mut state, "窗口启动失败");
        assert_eq!(state.phase, "off");
        assert_eq!(state.error.as_deref(), Some("窗口启动失败"));
        assert!(!accepts_event(&state, 8));
        assert!(!effective_key_config(&ordinary, &state).enabled);
    }

    #[test]
    fn locks_can_remain_visible_without_showing_keyboard_input() {
        let config = config::KeyVisualizerConfig {
            enabled: true,
            show_modifiers: false,
            show_combinations: false,
            show_characters: false,
            show_other: false,
            lock_keys: true,
            ..Default::default()
        };
        let status = VisualizerEffectsStatus {
            enabled: true,
            config: config.clone(),
            ..Default::default()
        };
        let keys = effective_key_config(&config, &status);
        assert!(keys.enabled);
        assert!(
            !keys.show_combinations
                && !keys.show_other
                && !keys.show_characters
                && !keys.show_modifiers
        );
    }
}

pub(crate) fn renderer_ready(app: &AppHandle) -> Result<(), String> {
    if let Err(error) = sync_visibility(app) {
        return Err(rollback(app, error));
    }
    publish(app);
    Ok(())
}
