//! Local presentation aids. Preferences are durable; the active session is not.
use crate::{config, key_visualizer, AppState};
use serde::{Deserialize, Serialize};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl,
    WebviewWindowBuilder,
};

mod shortcuts;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct PresentationConfig {
    pub keyboard: bool,
    pub clicks: bool,
    pub highlight: bool,
    pub lock_keys: bool,
    pub show_characters: bool,
    pub show_modifiers: bool,
    pub toggle_shortcut: String,
    pub locate_shortcut: String,
}

impl Default for PresentationConfig {
    fn default() -> Self {
        Self {
            keyboard: true,
            clicks: true,
            highlight: true,
            lock_keys: true,
            show_characters: false,
            show_modifiers: false,
            toggle_shortcut: "Ctrl+Alt+P".into(),
            locate_shortcut: "Ctrl+Alt+L".into(),
        }
    }
}

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
pub struct PresentationStatus {
    pub enabled: bool,
    pub suspended: bool,
    pub generation: u64,
    pub phase: String,
    pub error: Option<String>,
    pub shortcut_error: Option<String>,
    pub config: PresentationConfig,
    pub screens: Vec<Screen>,
    pub locks: Option<LockState>,
}

impl Default for PresentationStatus {
    fn default() -> Self {
        Self {
            enabled: false,
            suspended: false,
            generation: 0,
            phase: "off".into(),
            error: None,
            shortcut_error: None,
            config: PresentationConfig::default(),
            screens: vec![],
            locks: None,
        }
    }
}

#[derive(Default)]
pub struct PresentationRuntime {
    state: Mutex<PresentationStatus>,
    pub(crate) operation: Mutex<()>,
    ready: Mutex<std::collections::HashSet<String>>,
    started: Mutex<Option<Instant>>,
    shortcuts: Mutex<Vec<(String, bool)>>,
}

pub fn snapshot(app: &AppHandle) -> PresentationStatus {
    app.state::<PresentationRuntime>()
        .state
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

fn publish(app: &AppHandle) {
    let status = snapshot(app);
    if let Err(error) = app.emit("presentation-status", &status) {
        tracing::error!(%error, "发布演示状态失败");
    }
    crate::tray::sync_presentation(app, status.enabled, status.error.is_some());
}

pub fn effective_key_config(
    ordinary: &config::KeyVisualizerConfig,
    status: &PresentationStatus,
) -> config::KeyVisualizerConfig {
    let mut value = ordinary.clone();
    if status.enabled {
        value.enabled = status.config.keyboard || status.config.lock_keys;
        value.show_combinations = status.config.keyboard;
        value.show_other = status.config.keyboard;
        value.show_characters = status.config.keyboard && status.config.show_characters;
        value.show_modifiers = status.config.keyboard && status.config.show_modifiers;
    }
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
        && (s.config.keyboard || s.config.clicks || s.config.highlight || s.config.lock_keys)
}

fn apply_keys(app: &AppHandle) -> Result<(), String> {
    let ordinary = app
        .state::<AppState>()
        .config
        .lock()
        .map_err(|_| "配置状态已损坏")?
        .key_visualizer_config
        .clone();
    app.state::<key_visualizer::KeyVisualizerRuntime>()
        .apply(app, &ordinary)
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
            label: format!("presentation-{index}"),
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
        if label.starts_with("presentation-") {
            if let Err(error) = window.destroy() {
                errors.push(format!("关闭鼠标效果失败：{error}"));
            }
        }
    }
    app.state::<PresentationRuntime>()
        .ready
        .lock()
        .map_err(|_| "演示窗口状态已损坏")?
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
        app.state::<PresentationRuntime>()
            .state
            .lock()
            .map_err(|_| "演示状态已损坏")?
            .screens
            .clear();
        return sync_visibility(app);
    }
    let screens = screen_specs(app)?;
    if status.screens != screens {
        close_windows(app)?;
        let runtime = app.state::<PresentationRuntime>();
        let mut state = runtime.state.lock().map_err(|_| "演示状态已损坏")?;
        state.generation += 1;
        state.screens = screens.clone();
        state.phase = "starting".into();
        *runtime.started.lock().map_err(|_| "演示状态已损坏")? = Some(Instant::now());
    }
    for screen in &screens {
        if app.get_webview_window(&screen.label).is_none() {
            let runtime = app.state::<PresentationRuntime>();
            if runtime
                .ready
                .lock()
                .map_err(|_| "演示窗口状态已损坏")?
                .remove(&screen.label)
            {
                runtime
                    .state
                    .lock()
                    .map_err(|_| "演示状态已损坏")?
                    .generation += 1;
            }
            let window = WebviewWindowBuilder::new(
                app,
                &screen.label,
                WebviewUrl::App("presentation.html".into()),
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
    let runtime = app.state::<PresentationRuntime>();
    let ready = runtime
        .ready
        .lock()
        .map_err(|_| "演示窗口状态已损坏")?
        .clone();
    let status = snapshot(app);
    if !status.enabled {
        *runtime.started.lock().map_err(|_| "演示状态已损坏")? = None;
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
        runtime.state.lock().map_err(|_| "演示状态已损坏")?.phase = "starting".into();
        runtime
            .started
            .lock()
            .map_err(|_| "演示状态已损坏")?
            .get_or_insert_with(Instant::now);
    }
    if status.enabled && all_ready {
        runtime.state.lock().map_err(|_| "演示状态已损坏")?.phase = "running".into();
        *runtime.started.lock().map_err(|_| "演示状态已损坏")? = None;
    }
    Ok(())
}

fn rollback(app: &AppHandle, error: String) -> String {
    let runtime = app.state::<PresentationRuntime>();
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
        errors.push(format!("恢复普通按键展示失败：{error}"));
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

fn failed_session(state: &mut PresentationStatus, error: &str) {
    state.enabled = false;
    state.generation += 1;
    state.phase = "off".into();
    state.screens.clear();
    state.locks = None;
    state.error = Some(error.into());
}

pub fn set_enabled(app: &AppHandle, enabled: bool) -> Result<PresentationStatus, String> {
    let runtime = app.state::<PresentationRuntime>();
    let _operation = runtime.operation.lock().map_err(|_| "演示操作状态已损坏")?;
    {
        let mut state = runtime.state.lock().map_err(|_| "演示状态已损坏")?;
        if !transition(&mut state, enabled) {
            return Ok(state.clone());
        }
    }
    publish(app);
    let result = prepare_windows(app)
        .and_then(|_| apply_keys(app))
        .and_then(|_| sync_visibility(app));
    if let Err(error) = result {
        return Err(rollback(app, error));
    }
    publish(app);
    Ok(snapshot(app))
}

fn transition(state: &mut PresentationStatus, enabled: bool) -> bool {
    if state.enabled == enabled && state.error.is_none() {
        return false;
    }
    state.enabled = enabled;
    state.generation += 1;
    state.error = None;
    state.locks = None;
    state.phase = if enabled { "starting" } else { "off" }.into();
    true
}

pub fn dispatch_toggle(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = set_enabled(&app, !snapshot(&app).enabled) {
            tracing::error!(%error, "切换演示模式失败");
            crate::screenshot::show_main_window(&app);
            let _ = app.emit("navigate-main", serde_json::json!({"page":"keyvisualizer"}));
        }
    });
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
        if let Err(error) = app.emit_to(&screen.label, "presentation-mouse", &effect) {
            report_input_error(app, generation, format!("发送鼠标效果失败：{error}"));
        }
    }
}

fn accepts_event(status: &PresentationStatus, generation: u64) -> bool {
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
    app.state::<PresentationRuntime>()
        .state
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .locks = Some(value.clone());
    if let Err(error) = app.emit_to("key_visualizer", "presentation-locks", value) {
        report_input_error(app, generation, format!("发送锁定键状态失败：{error}"));
    }
}

pub fn report_error(app: &AppHandle, error: String) {
    report_input_error(app, snapshot(app).generation, error);
}

pub fn report_input_error(app: &AppHandle, generation: u64, error: String) {
    // The input thread must never wait for the UI thread (stop joins this thread).
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<PresentationRuntime>();
        let Ok(_operation) = runtime.operation.lock() else {
            return;
        };
        if accepts_event(&snapshot(&app), generation) {
            rollback(&app, error);
        }
    });
}

#[tauri::command]
pub fn get_presentation_status(app: AppHandle) -> PresentationStatus {
    snapshot(&app)
}

#[tauri::command]
pub fn get_presentation_config(state: State<'_, AppState>) -> Result<PresentationConfig, String> {
    Ok(state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏")?
        .presentation_config
        .clone())
}

#[tauri::command]
pub async fn set_presentation_enabled(
    app: AppHandle,
    enabled: bool,
) -> Result<PresentationStatus, String> {
    set_enabled(&app, enabled)
}

#[tauri::command]
pub async fn retry_presentation(app: AppHandle) -> Result<PresentationStatus, String> {
    {
        let state = app.state::<AppState>();
        let _mutation = state.mutation_lock.lock().map_err(|_| "配置写入锁已损坏")?;
        let runtime = app.state::<PresentationRuntime>();
        let _operation = runtime.operation.lock().map_err(|_| "演示操作状态已损坏")?;
        shortcuts::initialize(&app);
    }
    set_enabled(&app, true)
}

#[tauri::command]
pub async fn locate_presentation_mouse(app: AppHandle) -> Result<(), String> {
    let state = snapshot(&app);
    if !state.enabled || state.suspended {
        return Err("请先启用演示模式，并结束截图".into());
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
pub async fn presentation_ready(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<PresentationStatus, String> {
    let runtime = app.state::<PresentationRuntime>();
    let _operation = runtime.operation.lock().map_err(|_| "演示操作状态已损坏")?;
    if !snapshot(&app)
        .screens
        .iter()
        .any(|screen| screen.label == window.label())
    {
        return Err("演示窗口会话已结束".into());
    }
    runtime
        .ready
        .lock()
        .map_err(|_| "演示窗口状态已损坏")?
        .insert(window.label().into());
    if let Err(error) = sync_visibility(&app) {
        return Err(rollback(&app, error));
    }
    publish(&app);
    Ok(snapshot(&app))
}

#[tauri::command]
pub async fn update_presentation_config(
    app: AppHandle,
    mut presentation_config: PresentationConfig,
) -> Result<PresentationConfig, String> {
    presentation_config.toggle_shortcut = presentation_config.toggle_shortcut.trim().into();
    presentation_config.locate_shortcut = presentation_config.locate_shortcut.trim().into();
    shortcuts::validate(&presentation_config)?;
    let app_state = app.state::<AppState>();
    let _mutation = app_state
        .mutation_lock
        .lock()
        .map_err(|_| "配置写入锁已损坏")?;
    let runtime = app.state::<PresentationRuntime>();
    let _operation = runtime.operation.lock().map_err(|_| "演示操作状态已损坏")?;
    let previous = app_state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏")?
        .clone();
    let mut next = previous.clone();
    next.presentation_config = presentation_config.clone();
    // Register before saving; a conflict must not replace the user's working binding.
    commit_preferences(
        &previous.presentation_config,
        &presentation_config,
        |value| shortcuts::replace(&app, value),
        || config::save(&app_state.config_path, &next),
    )?;
    *app_state.config.lock().map_err(|_| "配置状态已损坏")? = next;
    {
        let mut state = runtime.state.lock().map_err(|_| "演示状态已损坏")?;
        state.config = presentation_config.clone();
        state.generation += 1;
        state.error = None;
    }
    if let Err(error) = prepare_windows(&app)
        .and_then(|_| apply_keys(&app))
        .and_then(|_| sync_visibility(&app))
    {
        // The preference was saved successfully; report the failed activation and restore ordinary mode.
        return Err(rollback(&app, format!("偏好已保存，但启用失败：{error}")));
    }
    publish(&app);
    Ok(presentation_config)
}

fn commit_preferences<R, S>(
    previous: &PresentationConfig,
    next: &PresentationConfig,
    mut register: R,
    save: S,
) -> Result<(), String>
where
    R: FnMut(&PresentationConfig) -> Result<(), String>,
    S: FnOnce() -> Result<(), String>,
{
    register(next)?;
    if let Err(error) = save() {
        return Err(match register(previous) {
            Ok(()) => error,
            Err(restore) => format!("{error}；恢复快捷键失败：{restore}"),
        });
    }
    Ok(())
}

pub fn initialize(app: &AppHandle) {
    let config = app
        .state::<AppState>()
        .config
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .presentation_config
        .clone();
    app.state::<PresentationRuntime>()
        .state
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .config = config;
    shortcuts::initialize(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if app.get_webview_window("main").is_none() {
                break;
            }
            let worker = app.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                let runtime = worker.state::<PresentationRuntime>();
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
    fn old_preferences_start_with_presentation_off_and_safe_key_filters() {
        let config: config::AppConfig = serde_json::from_str("{}").unwrap();
        assert!(config.presentation_config.keyboard);
        assert!(!config.presentation_config.show_characters);
        assert!(!PresentationStatus::default().enabled);
    }
    #[test]
    fn leaving_presentation_restores_the_ordinary_key_preferences() {
        let ordinary = config::KeyVisualizerConfig::default();
        let mut status = PresentationStatus {
            enabled: true,
            ..Default::default()
        };
        let effective = effective_key_config(&ordinary, &status);
        assert!(effective.show_combinations);
        assert!(!effective.show_characters);
        status.enabled = false;
        assert_eq!(effective_key_config(&ordinary, &status), ordinary);
    }
    #[test]
    fn old_mouse_events_cannot_reappear_after_stop_or_restart() {
        let mut status = PresentationStatus {
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
    fn repeated_start_and_stop_do_not_create_extra_sessions() {
        let mut status = PresentationStatus::default();
        assert!(transition(&mut status, true));
        let generation = status.generation;
        assert!(!transition(&mut status, true));
        assert_eq!(status.generation, generation);
        assert!(transition(&mut status, false));
        assert!(!transition(&mut status, false));
        assert!(!accepts_event(&status, generation));
    }
    #[test]
    fn failed_preference_save_restores_the_previous_shortcuts() {
        let previous = PresentationConfig::default();
        let next = PresentationConfig {
            toggle_shortcut: "Ctrl+Alt+T".into(),
            ..previous.clone()
        };
        let mut registrations = vec![];
        let result = commit_preferences(
            &previous,
            &next,
            |value| {
                registrations.push(value.toggle_shortcut.clone());
                Ok(())
            },
            || Err("磁盘写入失败".into()),
        );
        assert_eq!(result.unwrap_err(), "磁盘写入失败");
        assert_eq!(
            registrations,
            vec![next.toggle_shortcut, previous.toggle_shortcut]
        );
    }
    #[test]
    fn shortcut_conflict_does_not_write_preferences() {
        let config = PresentationConfig::default();
        let mut saved = false;
        assert!(commit_preferences(
            &config,
            &config,
            |_| Err("已占用".into()),
            || {
                saved = true;
                Ok(())
            }
        )
        .is_err());
        assert!(!saved);
    }
    #[test]
    fn failed_start_restores_ordinary_keys_and_invalidates_pending_effects() {
        let ordinary = config::KeyVisualizerConfig::default();
        let mut state = PresentationStatus {
            enabled: true,
            generation: 8,
            phase: "starting".into(),
            ..Default::default()
        };
        failed_session(&mut state, "窗口启动失败");
        assert_eq!(state.phase, "off");
        assert_eq!(state.error.as_deref(), Some("窗口启动失败"));
        assert!(!accepts_event(&state, 8));
        assert_eq!(effective_key_config(&ordinary, &state), ordinary);
    }
    #[test]
    fn locks_can_remain_visible_without_showing_keyboard_input() {
        let status = PresentationStatus {
            enabled: true,
            config: PresentationConfig {
                keyboard: false,
                ..Default::default()
            },
            ..Default::default()
        };
        let keys = effective_key_config(&config::KeyVisualizerConfig::default(), &status);
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
