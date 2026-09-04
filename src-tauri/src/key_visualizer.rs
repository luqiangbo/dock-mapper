use crate::{config, AppState};
use serde::Serialize;
use std::{
    collections::HashSet,
    mem::size_of,
    sync::{mpsc, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State};
use windows::{
    core::{w, PCWSTR},
    Win32::{
        Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM},
        System::{LibraryLoader::GetModuleHandleW, Threading::GetCurrentThreadId},
        UI::{
            Input::{
                GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE,
                RIDEV_INPUTSINK, RIDEV_REMOVE, RID_INPUT, RIM_TYPEKEYBOARD,
            },
            WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
                GetWindowLongPtrW, PostThreadMessageW, RegisterClassW,
                SetWindowLongPtrW, TranslateMessage, CREATESTRUCTW, GWLP_USERDATA, HWND_MESSAGE,
                MSG, RI_KEY_BREAK, WINDOW_EX_STYLE, WINDOW_STYLE, WM_INPUT, WM_NCCREATE, WM_QUIT,
                WNDCLASSW,
            },
        },
    },
};

const WINDOW_LABEL: &str = "key_visualizer";
const EVENT_INPUT: &str = "key-visualizer-input";
const EVENT_CONFIG: &str = "key-visualizer-config-changed";
const WINDOW_BASE_WIDTH: i32 = 360;
const WINDOW_BASE_HEIGHT: i32 = 250;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
enum KeyCategory {
    Modifier,
    Combination,
    Character,
    Other,
}

#[derive(Debug, Clone, Serialize)]
pub struct KeyVisualizerInput {
    label: String,
    category: KeyCategory,
    repeat: u32,
    timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct KeyVisualizerStatus {
    pub listening: bool,
    pub error: Option<String>,
}

struct ListenerHandle {
    thread_id: u32,
    join: JoinHandle<()>,
}

pub struct KeyVisualizerRuntime {
    listener: Mutex<Option<ListenerHandle>>,
    status: Mutex<KeyVisualizerStatus>,
}

impl Default for KeyVisualizerRuntime {
    fn default() -> Self {
        Self {
            listener: Mutex::new(None),
            status: Mutex::new(KeyVisualizerStatus::default()),
        }
    }
}

impl KeyVisualizerRuntime {
    fn status(&self) -> KeyVisualizerStatus {
        self.status.lock().map(|value| value.clone()).unwrap_or_else(|_| KeyVisualizerStatus {
            listening: false,
            error: Some("按键监听状态已损坏".into()),
        })
    }

    fn set_status(&self, listening: bool, error: Option<String>) {
        if let Ok(mut status) = self.status.lock() {
            *status = KeyVisualizerStatus { listening, error };
        }
    }

    fn start(&self, app: AppHandle, config: config::KeyVisualizerConfig) -> Result<(), String> {
        self.stop();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let join = match thread::Builder::new()
            .name("dockmapper-raw-input".into())
            .spawn(move || raw_input_thread(app, config, ready_tx))
        {
            Ok(join) => join,
            Err(error) => {
                let error = format!("创建按键监听线程失败：{error}");
                self.set_status(false, Some(error.clone()));
                return Err(error);
            }
        };
        match ready_rx.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(thread_id)) => {
                *self.listener.lock().map_err(|_| "按键监听状态已损坏".to_string())? =
                    Some(ListenerHandle { thread_id, join });
                self.set_status(true, None);
                Ok(())
            }
            Ok(Err(error)) => {
                let _ = join.join();
                self.set_status(false, Some(error.clone()));
                Err(error)
            }
            Err(_) => {
                self.set_status(false, Some("按键监听启动超时".into()));
                Err("按键监听启动超时".into())
            }
        }
    }

    pub fn stop(&self) {
        let listener = self.listener.lock().ok().and_then(|mut value| value.take());
        if let Some(listener) = listener {
            unsafe {
                let _ = PostThreadMessageW(listener.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
            }
            let _ = listener.join.join();
        }
        self.set_status(false, None);
    }

    fn apply(&self, app: &AppHandle, config: &config::KeyVisualizerConfig) -> Result<(), String> {
        if let Err(error) = configure_window(app, config) {
            self.set_status(false, Some(error.clone()));
            return Err(error);
        }
        if config.enabled {
            self.start(app.clone(), config.clone())?;
        } else {
            self.stop();
        }
        Ok(())
    }
}

impl Drop for KeyVisualizerRuntime {
    fn drop(&mut self) {
        self.stop();
    }
}

struct InputProcessor {
    app: AppHandle,
    config: config::KeyVisualizerConfig,
    classifier: KeyClassifier,
    repeat_tracker: RepeatTracker,
}

#[derive(Default)]
struct KeyClassifier {
    modifiers: Vec<u16>,
    used_modifiers: HashSet<u16>,
}

#[derive(Default)]
struct RepeatTracker {
    last_label: String,
    last_timestamp_ms: u64,
    repeat: u32,
}

impl InputProcessor {
    fn new(app: AppHandle, config: config::KeyVisualizerConfig) -> Self {
        Self {
            app,
            config,
            classifier: KeyClassifier::default(),
            repeat_tracker: RepeatTracker::default(),
        }
    }

    fn handle(&mut self, vkey: u16, is_down: bool) {
        if let Some((label, category)) = self.classifier.handle(vkey, is_down) {
            self.emit(label, category);
        }
    }

    fn emit(&mut self, label: String, category: KeyCategory) {
        if !category_enabled(&self.config, &category) {
            return;
        }
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let repeat = self.repeat_tracker.update(&label, timestamp_ms);
        let _ = self.app.emit_to(WINDOW_LABEL, EVENT_INPUT, KeyVisualizerInput {
            label,
            category,
            repeat,
            timestamp_ms,
        });
    }
}

impl KeyClassifier {
    fn handle(&mut self, vkey: u16, is_down: bool) -> Option<(String, KeyCategory)> {
        let vkey = normalize_modifier(vkey);
        if modifier_label(vkey).is_some() {
            if is_down {
                if !self.modifiers.contains(&vkey) {
                    self.modifiers.push(vkey);
                    self.used_modifiers.remove(&vkey);
                }
            } else {
                self.modifiers.retain(|key| *key != vkey);
                if !self.used_modifiers.remove(&vkey) {
                    if let Some(label) = modifier_label(vkey) {
                        return Some((label.to_string(), KeyCategory::Modifier));
                    }
                }
            }
            return None;
        }
        if !is_down {
            return None;
        }
        let Some((key, base_category)) = key_label(vkey) else {
            return None;
        };
        if self.modifiers.is_empty() {
            return Some((key, base_category));
        }
        let mut labels: Vec<&str> = self.modifiers.iter().filter_map(|key| modifier_label(*key)).collect();
        labels.sort_by_key(|label| match *label {
            "Ctrl" => 0,
            "Shift" => 1,
            "Alt" => 2,
            _ => 3,
        });
        labels.dedup();
        for modifier in &self.modifiers {
            self.used_modifiers.insert(*modifier);
        }
        let mut label = labels.join(" + ");
        label.push_str(" + ");
        label.push_str(&key);
        Some((label, KeyCategory::Combination))
    }
}

impl RepeatTracker {
    fn update(&mut self, label: &str, timestamp_ms: u64) -> u32 {
        if self.last_label == label && timestamp_ms.saturating_sub(self.last_timestamp_ms) <= 1000 {
            self.repeat = self.repeat.saturating_add(1);
        } else {
            self.last_label.clear();
            self.last_label.push_str(label);
            self.repeat = 1;
        }
        self.last_timestamp_ms = timestamp_ms;
        self.repeat
    }
}

fn category_enabled(config: &config::KeyVisualizerConfig, category: &KeyCategory) -> bool {
    match category {
        KeyCategory::Modifier => config.show_modifiers,
        KeyCategory::Combination => config.show_combinations,
        KeyCategory::Character => config.show_characters,
        KeyCategory::Other => config.show_other,
    }
}

fn normalize_modifier(vkey: u16) -> u16 {
    match vkey {
        0xA0 | 0xA1 => 0x10,
        0xA2 | 0xA3 => 0x11,
        0xA4 | 0xA5 => 0x12,
        0x5B | 0x5C => 0x5B,
        other => other,
    }
}

fn modifier_label(vkey: u16) -> Option<&'static str> {
    match vkey {
        0x10 => Some("Shift"),
        0x11 => Some("Ctrl"),
        0x12 => Some("Alt"),
        0x5B => Some("Win"),
        _ => None,
    }
}

fn key_label(vkey: u16) -> Option<(String, KeyCategory)> {
    if (0x41..=0x5A).contains(&vkey) || (0x30..=0x39).contains(&vkey) {
        return char::from_u32(vkey as u32).map(|value| (value.to_string(), KeyCategory::Character));
    }
    let character = match vkey {
        0x20 => Some("Space"),
        0xBA => Some(";"),
        0xBB => Some("="),
        0xBC => Some(","),
        0xBD => Some("-"),
        0xBE => Some("."),
        0xBF => Some("/"),
        0xC0 => Some("`"),
        0xDB => Some("["),
        0xDC => Some("\\"),
        0xDD => Some("]"),
        0xDE => Some("'"),
        _ => None,
    };
    if let Some(label) = character {
        return Some((label.into(), KeyCategory::Character));
    }
    let other = match vkey {
        0x08 => "Backspace",
        0x09 => "Tab",
        0x0D => "Enter",
        0x14 => "Caps Lock",
        0x1B => "Esc",
        0x21 => "Page Up",
        0x22 => "Page Down",
        0x23 => "End",
        0x24 => "Home",
        0x25 => "←",
        0x26 => "↑",
        0x27 => "→",
        0x28 => "↓",
        0x2D => "Insert",
        0x2E => "Delete",
        0x60..=0x69 => return Some((format!("Num {}", vkey - 0x60), KeyCategory::Other)),
        0x70..=0x87 => return Some((format!("F{}", vkey - 0x6F), KeyCategory::Other)),
        _ => return None,
    };
    Some((other.into(), KeyCategory::Other))
}

unsafe extern "system" fn raw_input_wnd_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_NCCREATE {
        let create = &*(lparam.0 as *const CREATESTRUCTW);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, create.lpCreateParams as isize);
    } else if message == WM_INPUT {
        let pointer = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut InputProcessor;
        if !pointer.is_null() {
            let mut input = RAWINPUT::default();
            let mut size = size_of::<RAWINPUT>() as u32;
            let read = GetRawInputData(
                HRAWINPUT(lparam.0 as *mut _),
                RID_INPUT,
                Some((&mut input as *mut RAWINPUT).cast()),
                &mut size,
                size_of::<windows::Win32::UI::Input::RAWINPUTHEADER>() as u32,
            );
            if read != u32::MAX && input.header.dwType == RIM_TYPEKEYBOARD.0 {
                let keyboard = input.data.keyboard;
                (*pointer).handle(keyboard.VKey, keyboard.Flags as u32 & RI_KEY_BREAK == 0);
            }
        }
    }
    DefWindowProcW(hwnd, message, wparam, lparam)
}

fn raw_input_thread(
    app: AppHandle,
    config: config::KeyVisualizerConfig,
    ready: mpsc::SyncSender<Result<u32, String>>,
) {
    unsafe {
        let thread_id = GetCurrentThreadId();
        let module = match GetModuleHandleW(PCWSTR::null()) {
            Ok(module) => module,
            Err(error) => {
                let _ = ready.send(Err(format!("读取程序模块失败：{error}")));
                return;
            }
        };
        let class = WNDCLASSW {
            hInstance: HINSTANCE(module.0),
            lpszClassName: w!("DockMapperKeyVisualizerRawInput"),
            lpfnWndProc: Some(raw_input_wnd_proc),
            ..Default::default()
        };
        RegisterClassW(&class);
        let mut processor = Box::new(InputProcessor::new(app, config));
        let hwnd = match CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class.lpszClassName,
            w!("DockMapper Raw Input"),
            WINDOW_STYLE::default(),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(class.hInstance),
            Some((&mut *processor as *mut InputProcessor).cast()),
        ) {
            Ok(hwnd) => hwnd,
            Err(error) => {
                let _ = ready.send(Err(format!("创建按键监听窗口失败：{error}")));
                return;
            }
        };
        let devices = [RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x06,
            dwFlags: RIDEV_INPUTSINK,
            hwndTarget: hwnd,
        }];
        if let Err(error) = RegisterRawInputDevices(&devices, size_of::<RAWINPUTDEVICE>() as u32) {
            let _ = DestroyWindow(hwnd);
            let _ = ready.send(Err(format!("注册 Raw Input 键盘失败：{error}")));
            return;
        }
        let _ = ready.send(Ok(thread_id));
        let mut message = MSG::default();
        loop {
            let result = GetMessageW(&mut message, None, 0, 0);
            if result.0 <= 0 {
                break;
            }
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        let _ = RegisterRawInputDevices(
            &[RAWINPUTDEVICE {
                usUsagePage: 0x01,
                usUsage: 0x06,
                dwFlags: RIDEV_REMOVE,
                hwndTarget: HWND::default(),
            }],
            size_of::<RAWINPUTDEVICE>() as u32,
        );
        let _ = DestroyWindow(hwnd);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ScreenBounds {
    x: i32,
    y: i32,
    height: i32,
}

fn fixed_bottom_left_position(
    scale_percent: u16,
    work_area: Option<ScreenBounds>,
) -> Result<PhysicalPosition<i32>, String> {
    let height = WINDOW_BASE_HEIGHT * i32::from(scale_percent) / 100;
    let work_area = work_area.ok_or_else(|| "未检测到主显示器，无法定位按键文本窗口".to_string())?;
    Ok(PhysicalPosition::new(
        work_area.x,
        work_area.y + work_area.height - height.min(work_area.height),
    ))
}

fn sync_window_geometry(app: &AppHandle, config: &config::KeyVisualizerConfig) -> Result<(), String> {
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "按键文本窗口不存在".to_string())?;
    let scale = i32::from(config.scale_percent);
    let target_size = PhysicalSize::new(
        (WINDOW_BASE_WIDTH * scale / 100) as u32,
        (WINDOW_BASE_HEIGHT * scale / 100) as u32,
    );
    let monitor = window
        .primary_monitor()
        .map_err(|error| format!("读取主显示器失败：{error}"))?;
    let work_area = monitor.map(|monitor| {
        let area = monitor.work_area();
        ScreenBounds {
            x: area.position.x,
            y: area.position.y,
            height: area.size.height as i32,
        }
    });
    let target_position = fixed_bottom_left_position(config.scale_percent, work_area)?;
    if window.inner_size().map_err(|error| format!("读取按键文本窗口尺寸失败：{error}"))? != target_size {
        window
            .set_size(target_size)
            .map_err(|error| format!("调整按键文本窗口失败：{error}"))?;
    }
    if window.outer_position().map_err(|error| format!("读取按键文本窗口位置失败：{error}"))? != target_position {
        window
            .set_position(target_position)
            .map_err(|error| format!("移动按键文本窗口失败：{error}"))?;
    }
    window
        .set_ignore_cursor_events(true)
        .map_err(|error| format!("启用鼠标穿透失败：{error}"))?;
    Ok(())
}

fn configure_window(app: &AppHandle, config: &config::KeyVisualizerConfig) -> Result<(), String> {
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "按键文本窗口不存在".to_string())?;
    window
        .set_ignore_cursor_events(true)
        .map_err(|error| format!("启用鼠标穿透失败：{error}"))?;
    if config.enabled {
        sync_window_geometry(app, config)?;
        window.show().map_err(|error| format!("显示按键文本窗口失败：{error}"))?;
    } else {
        window.hide().map_err(|error| format!("隐藏按键文本窗口失败：{error}"))?;
    }
    let _ = app.emit(EVENT_CONFIG, config);
    Ok(())
}

pub fn initialize(app: &AppHandle, config: &config::KeyVisualizerConfig) -> Result<(), String> {
    app.state::<KeyVisualizerRuntime>().apply(app, config)
}

fn reanchor_enabled_window(app: &AppHandle) {
    let state = app.state::<AppState>();
    let config = state
        .config
        .lock()
        .map(|config| config.key_visualizer_config.clone());
    let Ok(config) = config else {
        return;
    };
    if !config.enabled {
        return;
    }
    if let Err(error) = sync_window_geometry(app, &config) {
        let runtime = app.state::<KeyVisualizerRuntime>();
        runtime.set_status(runtime.status().listening, Some(error));
    }
}

pub fn setup_window(app: &tauri::App) -> Result<(), String> {
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "按键文本窗口不存在".to_string())?;
    let app_handle = app.handle().clone();
    window.on_window_event(move |event| {
        if !matches!(
            event,
            tauri::WindowEvent::Moved(_)
                | tauri::WindowEvent::Resized(_)
                | tauri::WindowEvent::ScaleFactorChanged { .. }
        ) {
            return;
        }
        reanchor_enabled_window(&app_handle);
    });
    let recovery_app = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(15)).await;
            if recovery_app.get_webview_window(WINDOW_LABEL).is_none() {
                break;
            }
            reanchor_enabled_window(&recovery_app);
        }
    });
    Ok(())
}

fn commit_key_visualizer_change_with<A, S>(
    previous: &config::AppConfig,
    next: &config::AppConfig,
    mut apply: A,
    mut save: S,
) -> Result<(), String>
where
    A: FnMut(&config::KeyVisualizerConfig) -> Result<(), String>,
    S: FnMut(&config::AppConfig) -> Result<(), String>,
{
    save(next)?;
    if let Err(error) = apply(&next.key_visualizer_config) {
        let runtime_rollback = apply(&previous.key_visualizer_config).err();
        let config_rollback = save(previous).err();
        return Err(match (runtime_rollback, config_rollback) {
            (None, None) => error,
            (Some(runtime), None) => format!("{error}；同时恢复监听失败：{runtime}"),
            (None, Some(config)) => format!("{error}；同时恢复配置失败：{config}"),
            (Some(runtime), Some(config)) => {
                format!("{error}；同时恢复监听失败：{runtime}；恢复配置失败：{config}")
            }
        });
    }
    Ok(())
}

#[tauri::command]
pub fn get_key_visualizer_config(
    state: State<'_, AppState>,
) -> Result<config::KeyVisualizerConfig, String> {
    state
        .config
        .lock()
        .map(|config| config.key_visualizer_config.clone())
        .map_err(|_| "配置状态已损坏".to_string())
}

#[tauri::command]
pub fn get_key_visualizer_status(
    runtime: State<'_, KeyVisualizerRuntime>,
) -> KeyVisualizerStatus {
    runtime.status()
}

#[tauri::command]
pub fn update_key_visualizer_config(
    app: AppHandle,
    state: State<'_, AppState>,
    runtime: State<'_, KeyVisualizerRuntime>,
    mut key_visualizer_config: config::KeyVisualizerConfig,
) -> Result<config::KeyVisualizerConfig, String> {
    config::normalize_key_visualizer_config(&mut key_visualizer_config);
    let _mutation = state.mutation_lock.lock().map_err(|_| "配置写入锁已损坏".to_string())?;
    let previous = state.config.lock().map_err(|_| "配置状态已损坏".to_string())?.clone();
    let mut next = previous.clone();
    next.key_visualizer_config = key_visualizer_config.clone();
    commit_key_visualizer_change_with(
        &previous,
        &next,
        |value| runtime.apply(&app, value),
        |value| config::save(&state.config_path, value),
    )?;
    *state.config.lock().map_err(|_| "配置状态已损坏".to_string())? = next;
    Ok(key_visualizer_config)
}

#[tauri::command]
pub fn retry_key_visualizer(
    app: AppHandle,
    state: State<'_, AppState>,
    runtime: State<'_, KeyVisualizerRuntime>,
) -> Result<KeyVisualizerStatus, String> {
    let config = get_key_visualizer_config(state)?;
    runtime.apply(&app, &config)?;
    Ok(runtime.status())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> config::KeyVisualizerConfig {
        config::KeyVisualizerConfig::default()
    }

    #[test]
    fn key_categories_cover_character_and_other_keys() {
        assert!(matches!(key_label(0x41), Some((label, KeyCategory::Character)) if label == "A"));
        assert!(matches!(key_label(0x0D), Some((label, KeyCategory::Other)) if label == "Enter"));
    }

    #[test]
    fn filters_can_disable_each_visible_category() {
        let mut value = config();
        value.show_combinations = false;
        assert!(!category_enabled(&value, &KeyCategory::Combination));
        assert!(category_enabled(&value, &KeyCategory::Character));
    }

    #[test]
    fn modifier_used_in_combination_does_not_emit_a_second_standalone_key() {
        let mut classifier = KeyClassifier::default();
        assert!(classifier.handle(0x11, true).is_none());
        assert!(classifier.handle(0x10, true).is_none());
        let combined = classifier.handle(0x53, true).expect("combination");
        assert_eq!(combined.0, "Ctrl + Shift + S");
        assert!(matches!(combined.1, KeyCategory::Combination));
        assert!(classifier.handle(0x53, false).is_none());
        assert!(classifier.handle(0x10, false).is_none());
        assert!(classifier.handle(0x11, false).is_none());
    }

    #[test]
    fn standalone_modifier_emits_on_release_and_repeated_input_is_counted() {
        let mut classifier = KeyClassifier::default();
        assert!(classifier.handle(0x11, true).is_none());
        let released = classifier.handle(0x11, false).expect("modifier release");
        assert_eq!(released.0, "Ctrl");
        let mut repeats = RepeatTracker::default();
        assert_eq!(repeats.update("A", 100), 1);
        assert_eq!(repeats.update("A", 200), 2);
        assert_eq!(repeats.update("A", 1_500), 1);
    }

    #[test]
    fn fixed_position_uses_primary_work_area_bottom_left() {
        let position = fixed_bottom_left_position(
            100,
            Some(ScreenBounds { x: -1920, y: 0, height: 1040 }),
        ).expect("primary monitor");
        assert_eq!(position, PhysicalPosition::new(-1920, 790));
        let scaled = fixed_bottom_left_position(
            200,
            Some(ScreenBounds { x: 0, y: 40, height: 1040 }),
        ).expect("scaled position");
        assert_eq!(scaled, PhysicalPosition::new(0, 580));
    }

    #[test]
    fn missing_primary_monitor_reports_a_visible_positioning_error() {
        assert_eq!(
            fixed_bottom_left_position(100, None).unwrap_err(),
            "未检测到主显示器，无法定位按键文本窗口"
        );
    }

    #[test]
    fn config_transaction_restores_saved_config_when_runtime_apply_fails() {
        let previous = config::AppConfig::default();
        let mut next = previous.clone();
        next.key_visualizer_config.enabled = true;
        let applied = Mutex::new(Vec::new());
        let saved = Mutex::new(Vec::new());
        let result = commit_key_visualizer_change_with(
            &previous,
            &next,
            |value| {
                applied.lock().unwrap().push(value.enabled);
                if value.enabled { Err("监听失败".into()) } else { Ok(()) }
            },
            |value| {
                saved.lock().unwrap().push(value.key_visualizer_config.enabled);
                Ok(())
            },
        );
        assert_eq!(result.unwrap_err(), "监听失败");
        assert_eq!(*applied.lock().unwrap(), vec![true, false]);
        assert_eq!(*saved.lock().unwrap(), vec![true, false]);
    }
}
