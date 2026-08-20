mod admin;
mod config;
#[cfg(target_os = "windows")]
mod dxgi_capture;
mod litesnap;
mod ocr;
mod scancode_mapper;
mod sys_monitor;
mod taskbar;

use serde::{Deserialize, Deserializer, Serialize};
use std::{path::PathBuf, sync::Mutex};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};

const DEFAULT_WIDGET_WIDTH: f64 = 180.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum KeyCode {
    Disabled,
    CapsLock,
    ShiftLeft,
    ShiftRight,
    ControlLeft,
    ControlRight,
    Alt,
    AltGr,
    MetaLeft,
    MetaRight,
    Tab,
    Escape,
    Space,
    Return,
    Backspace,
    Delete,
    Insert,
    Home,
    End,
    PageUp,
    PageDown,
    F1,
    F2,
    F3,
    F4,
    F5,
    F6,
    F7,
    F8,
    F9,
    F10,
    F11,
    F12,
    KeyA,
    KeyB,
    KeyC,
    KeyD,
    KeyE,
    KeyF,
    KeyG,
    KeyH,
    KeyI,
    KeyJ,
    KeyK,
    KeyL,
    KeyM,
    KeyN,
    KeyO,
    KeyP,
    KeyQ,
    KeyR,
    KeyS,
    KeyT,
    KeyU,
    KeyV,
    KeyW,
    KeyX,
    KeyY,
    KeyZ,
    Num0,
    Num1,
    Num2,
    Num3,
    Num4,
    Num5,
    Num6,
    Num7,
    Num8,
    Num9,
    ArrowUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    Kp0,
    Kp1,
    Kp2,
    Kp3,
    Kp4,
    Kp5,
    Kp6,
    Kp7,
    Kp8,
    Kp9,
}

impl KeyCode {
    pub fn code(self) -> &'static str {
        match self {
            Self::Disabled => "Disabled",
            Self::CapsLock => "CapsLock",
            Self::ShiftLeft => "ShiftLeft",
            Self::ShiftRight => "ShiftRight",
            Self::ControlLeft => "ControlLeft",
            Self::ControlRight => "ControlRight",
            Self::Alt => "Alt",
            Self::AltGr => "AltGr",
            Self::MetaLeft => "MetaLeft",
            Self::MetaRight => "MetaRight",
            Self::Tab => "Tab",
            Self::Escape => "Escape",
            Self::Space => "Space",
            Self::Return => "Return",
            Self::Backspace => "Backspace",
            Self::Delete => "Delete",
            Self::Insert => "Insert",
            Self::Home => "Home",
            Self::End => "End",
            Self::PageUp => "PageUp",
            Self::PageDown => "PageDown",
            Self::F1 => "F1",
            Self::F2 => "F2",
            Self::F3 => "F3",
            Self::F4 => "F4",
            Self::F5 => "F5",
            Self::F6 => "F6",
            Self::F7 => "F7",
            Self::F8 => "F8",
            Self::F9 => "F9",
            Self::F10 => "F10",
            Self::F11 => "F11",
            Self::F12 => "F12",
            Self::KeyA => "KeyA",
            Self::KeyB => "KeyB",
            Self::KeyC => "KeyC",
            Self::KeyD => "KeyD",
            Self::KeyE => "KeyE",
            Self::KeyF => "KeyF",
            Self::KeyG => "KeyG",
            Self::KeyH => "KeyH",
            Self::KeyI => "KeyI",
            Self::KeyJ => "KeyJ",
            Self::KeyK => "KeyK",
            Self::KeyL => "KeyL",
            Self::KeyM => "KeyM",
            Self::KeyN => "KeyN",
            Self::KeyO => "KeyO",
            Self::KeyP => "KeyP",
            Self::KeyQ => "KeyQ",
            Self::KeyR => "KeyR",
            Self::KeyS => "KeyS",
            Self::KeyT => "KeyT",
            Self::KeyU => "KeyU",
            Self::KeyV => "KeyV",
            Self::KeyW => "KeyW",
            Self::KeyX => "KeyX",
            Self::KeyY => "KeyY",
            Self::KeyZ => "KeyZ",
            Self::Num0 => "Num0",
            Self::Num1 => "Num1",
            Self::Num2 => "Num2",
            Self::Num3 => "Num3",
            Self::Num4 => "Num4",
            Self::Num5 => "Num5",
            Self::Num6 => "Num6",
            Self::Num7 => "Num7",
            Self::Num8 => "Num8",
            Self::Num9 => "Num9",
            Self::ArrowUp => "ArrowUp",
            Self::ArrowDown => "ArrowDown",
            Self::ArrowLeft => "ArrowLeft",
            Self::ArrowRight => "ArrowRight",
            Self::Kp0 => "Kp0",
            Self::Kp1 => "Kp1",
            Self::Kp2 => "Kp2",
            Self::Kp3 => "Kp3",
            Self::Kp4 => "Kp4",
            Self::Kp5 => "Kp5",
            Self::Kp6 => "Kp6",
            Self::Kp7 => "Kp7",
            Self::Kp8 => "Kp8",
            Self::Kp9 => "Kp9",
        }
    }

    pub fn vk(self) -> u16 {
        match self {
            Self::Disabled => 0,
            Self::Backspace => 0x08,
            Self::Tab => 0x09,
            Self::Return => 0x0D,
            Self::ShiftLeft => 0xA0,
            Self::ShiftRight => 0xA1,
            Self::ControlLeft => 0xA2,
            Self::ControlRight => 0xA3,
            Self::Alt => 0xA4,
            Self::AltGr => 0xA5,
            Self::CapsLock => 0x14,
            Self::Escape => 0x1B,
            Self::Space => 0x20,
            Self::PageUp => 0x21,
            Self::PageDown => 0x22,
            Self::End => 0x23,
            Self::Home => 0x24,
            Self::ArrowLeft => 0x25,
            Self::ArrowUp => 0x26,
            Self::ArrowRight => 0x27,
            Self::ArrowDown => 0x28,
            Self::Insert => 0x2D,
            Self::Delete => 0x2E,
            Self::Num0 => 0x30,
            Self::Num1 => 0x31,
            Self::Num2 => 0x32,
            Self::Num3 => 0x33,
            Self::Num4 => 0x34,
            Self::Num5 => 0x35,
            Self::Num6 => 0x36,
            Self::Num7 => 0x37,
            Self::Num8 => 0x38,
            Self::Num9 => 0x39,
            Self::KeyA => 0x41,
            Self::KeyB => 0x42,
            Self::KeyC => 0x43,
            Self::KeyD => 0x44,
            Self::KeyE => 0x45,
            Self::KeyF => 0x46,
            Self::KeyG => 0x47,
            Self::KeyH => 0x48,
            Self::KeyI => 0x49,
            Self::KeyJ => 0x4A,
            Self::KeyK => 0x4B,
            Self::KeyL => 0x4C,
            Self::KeyM => 0x4D,
            Self::KeyN => 0x4E,
            Self::KeyO => 0x4F,
            Self::KeyP => 0x50,
            Self::KeyQ => 0x51,
            Self::KeyR => 0x52,
            Self::KeyS => 0x53,
            Self::KeyT => 0x54,
            Self::KeyU => 0x55,
            Self::KeyV => 0x56,
            Self::KeyW => 0x57,
            Self::KeyX => 0x58,
            Self::KeyY => 0x59,
            Self::KeyZ => 0x5A,
            Self::MetaLeft => 0x5B,
            Self::MetaRight => 0x5C,
            Self::Kp0 => 0x60,
            Self::Kp1 => 0x61,
            Self::Kp2 => 0x62,
            Self::Kp3 => 0x63,
            Self::Kp4 => 0x64,
            Self::Kp5 => 0x65,
            Self::Kp6 => 0x66,
            Self::Kp7 => 0x67,
            Self::Kp8 => 0x68,
            Self::Kp9 => 0x69,
            Self::F1 => 0x70,
            Self::F2 => 0x71,
            Self::F3 => 0x72,
            Self::F4 => 0x73,
            Self::F5 => 0x74,
            Self::F6 => 0x75,
            Self::F7 => 0x76,
            Self::F8 => 0x77,
            Self::F9 => 0x78,
            Self::F10 => 0x79,
            Self::F11 => 0x7A,
            Self::F12 => 0x7B,
        }
    }

    pub fn is_extended(self) -> bool {
        matches!(
            self,
            Self::ControlRight
                | Self::AltGr
                | Self::MetaLeft
                | Self::MetaRight
                | Self::Insert
                | Self::Delete
                | Self::Home
                | Self::End
                | Self::PageUp
                | Self::PageDown
                | Self::ArrowUp
                | Self::ArrowDown
                | Self::ArrowLeft
                | Self::ArrowRight
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyMapping {
    pub id: String,
    pub source_key: KeyCode,
    pub target_key: KeyCode,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SupportedKey {
    pub code: KeyCode,
    pub label: &'static str,
    pub group: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineStatus {
    pub running: bool,
    pub enabled: bool,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryScheme {
    #[default]
    Capsule,
    Ring,
    Gauge,
}

impl<'de> Deserialize<'de> for MemoryScheme {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Repr {
            Name(String),
            Legacy(u8),
        }

        match Repr::deserialize(deserializer)? {
            Repr::Name(value) => match value.as_str() {
                "capsule" => Ok(Self::Capsule),
                "ring" => Ok(Self::Ring),
                "gauge" => Ok(Self::Gauge),
                _ => Err(serde::de::Error::custom("未知的内存显示方案")),
            },
            Repr::Legacy(1) => Ok(Self::Capsule),
            Repr::Legacy(2) => Ok(Self::Ring),
            Repr::Legacy(3) => Ok(Self::Gauge),
            Repr::Legacy(_) => Err(serde::de::Error::custom("旧版内存显示方案超出范围")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WidgetConfig {
    pub memory_scheme: MemoryScheme,
    pub refresh_interval_secs: u8,
}

impl Default for WidgetConfig {
    fn default() -> Self {
        Self {
            memory_scheme: MemoryScheme::Capsule,
            refresh_interval_secs: 1,
        }
    }
}

pub struct AppState {
    pub config: Mutex<config::AppConfig>,
    config_path: PathBuf,
    widget_width: Mutex<f64>,
    mutation_lock: Mutex<()>,
}

fn persist(state: &AppState) -> Result<(), String> {
    let config = state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())?
        .clone();
    config::save(&state.config_path, &config)
}

#[tauri::command]
fn get_supported_keys() -> Vec<SupportedKey> {
    const KEYS: &[KeyCode] = &[
        KeyCode::Disabled,
        KeyCode::CapsLock,
        KeyCode::ShiftLeft,
        KeyCode::ShiftRight,
        KeyCode::ControlLeft,
        KeyCode::ControlRight,
        KeyCode::Alt,
        KeyCode::AltGr,
        KeyCode::MetaLeft,
        KeyCode::MetaRight,
        KeyCode::Tab,
        KeyCode::Escape,
        KeyCode::Space,
        KeyCode::Return,
        KeyCode::Backspace,
        KeyCode::Delete,
        KeyCode::Insert,
        KeyCode::Home,
        KeyCode::End,
        KeyCode::PageUp,
        KeyCode::PageDown,
        KeyCode::F1,
        KeyCode::F2,
        KeyCode::F3,
        KeyCode::F4,
        KeyCode::F5,
        KeyCode::F6,
        KeyCode::F7,
        KeyCode::F8,
        KeyCode::F9,
        KeyCode::F10,
        KeyCode::F11,
        KeyCode::F12,
        KeyCode::KeyA,
        KeyCode::KeyB,
        KeyCode::KeyC,
        KeyCode::KeyD,
        KeyCode::KeyE,
        KeyCode::KeyF,
        KeyCode::KeyG,
        KeyCode::KeyH,
        KeyCode::KeyI,
        KeyCode::KeyJ,
        KeyCode::KeyK,
        KeyCode::KeyL,
        KeyCode::KeyM,
        KeyCode::KeyN,
        KeyCode::KeyO,
        KeyCode::KeyP,
        KeyCode::KeyQ,
        KeyCode::KeyR,
        KeyCode::KeyS,
        KeyCode::KeyT,
        KeyCode::KeyU,
        KeyCode::KeyV,
        KeyCode::KeyW,
        KeyCode::KeyX,
        KeyCode::KeyY,
        KeyCode::KeyZ,
        KeyCode::Num0,
        KeyCode::Num1,
        KeyCode::Num2,
        KeyCode::Num3,
        KeyCode::Num4,
        KeyCode::Num5,
        KeyCode::Num6,
        KeyCode::Num7,
        KeyCode::Num8,
        KeyCode::Num9,
        KeyCode::ArrowUp,
        KeyCode::ArrowDown,
        KeyCode::ArrowLeft,
        KeyCode::ArrowRight,
        KeyCode::Kp0,
        KeyCode::Kp1,
        KeyCode::Kp2,
        KeyCode::Kp3,
        KeyCode::Kp4,
        KeyCode::Kp5,
        KeyCode::Kp6,
        KeyCode::Kp7,
        KeyCode::Kp8,
        KeyCode::Kp9,
    ];

    KEYS.iter()
        .copied()
        .map(|code| {
            let raw = code.code();
            let (label, group) = if let Some(label) = raw.strip_prefix("Key") {
                (label, "字母")
            } else if let Some(label) = raw.strip_prefix("Num") {
                (label, "数字")
            } else if raw.starts_with("Kp") {
                (raw, "数字键盘")
            } else if raw.starts_with('F') && raw[1..].chars().all(|char| char.is_ascii_digit()) {
                (raw, "功能键")
            } else {
                (raw, "控制与导航")
            };
            SupportedKey { code, label, group }
        })
        .collect()
}

#[tauri::command]
fn get_key_mappings(state: State<'_, AppState>) -> Result<Vec<KeyMapping>, String> {
    state
        .config
        .lock()
        .map(|config| config.key_mappings.clone())
        .map_err(|_| "配置状态已损坏".to_string())
}

#[tauri::command]
fn sync_key_mappings(
    app: AppHandle,
    state: State<'_, AppState>,
    mappings: Vec<KeyMapping>,
) -> Result<(), String> {
    let _mutation = state
        .mutation_lock
        .lock()
        .map_err(|_| "配置写入锁已损坏".to_string())?;
    scancode_mapper::encode(&mappings)?;
    let previous_config = {
        let mut config = state
            .config
            .lock()
            .map_err(|_| "配置状态已损坏".to_string())?;
        let previous = config.clone();
        config.key_mappings = mappings;
        previous
    };
    if let Err(error) = persist(&state) {
        *state
            .config
            .lock()
            .map_err(|_| "配置状态已损坏".to_string())? = previous_config;
        return Err(error);
    }
    app.emit("config-changed", ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_engine_status(state: State<'_, AppState>) -> EngineStatus {
    let applied = state
        .config
        .lock()
        .map(|config| config.scancode_map_applied)
        .unwrap_or(false);
    EngineStatus {
        running: false,
        enabled: applied,
        last_error: None,
    }
}

#[tauri::command]
fn set_engine_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<EngineStatus, String> {
    let _ = app;
    let _ = state;
    let _ = enabled;
    Err("按键映射已改为系统扫描码模式，请使用“应用到系统”按钮".into())
}

#[derive(Debug, Clone, Serialize)]
pub struct ScancodeMapStatus {
    pub applied: bool,
    pub has_external_map: bool,
    pub requires_restart: bool,
    pub backup_available: bool,
}

#[tauri::command]
fn get_scancode_map_status(state: State<'_, AppState>) -> Result<ScancodeMapStatus, String> {
    let config = state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())?
        .clone();
    let desired = scancode_mapper::encode(&config.key_mappings)?;
    let current = scancode_mapper::read()?;
    let current_is_ours = current.as_deref() == Some(desired.as_slice());
    Ok(ScancodeMapStatus {
        applied: config.scancode_map_applied && current_is_ours,
        has_external_map: current.is_some() && !current_is_ours,
        requires_restart: config.scancode_map_applied,
        backup_available: config.scancode_map_backup.is_some(),
    })
}

#[tauri::command]
fn apply_scancode_map(
    app: AppHandle,
    state: State<'_, AppState>,
    confirm_takeover: bool,
) -> Result<ScancodeMapStatus, String> {
    if !admin::is_elevated() {
        return Err("写入系统键盘映射需要管理员权限".into());
    }
    let _mutation = state
        .mutation_lock
        .lock()
        .map_err(|_| "配置写入锁已损坏".to_string())?;
    let mut config = state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())?;
    let desired = scancode_mapper::encode(&config.key_mappings)?;
    let current = scancode_mapper::read()?;
    if current.as_deref() != Some(desired.as_slice())
        && current.is_some()
        && !config.scancode_map_applied
        && !confirm_takeover
    {
        return Err("系统已存在其他工具写入的 Scancode Map；请确认备份后接管".into());
    }
    if config.scancode_map_backup.is_none() {
        config.scancode_map_backup =
            Some(scancode_mapper::backup_encode(current.as_deref()).unwrap_or_default());
    }
    scancode_mapper::write(Some(&desired))?;
    config.scancode_map_applied = true;
    persist(&state)?;
    drop(config);
    app.emit("scancode-map-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(ScancodeMapStatus {
        applied: true,
        has_external_map: false,
        requires_restart: true,
        backup_available: true,
    })
}

#[tauri::command]
fn restore_scancode_map(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ScancodeMapStatus, String> {
    if !admin::is_elevated() {
        return Err("恢复系统键盘映射需要管理员权限".into());
    }
    let _mutation = state
        .mutation_lock
        .lock()
        .map_err(|_| "配置写入锁已损坏".to_string())?;
    let mut config = state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())?;
    let backup = scancode_mapper::backup_decode(config.scancode_map_backup.as_deref())?;
    if config.scancode_map_backup.is_none() {
        return Err("没有可恢复的应用前映射".into());
    }
    scancode_mapper::write(backup.as_deref())?;
    config.scancode_map_applied = false;
    persist(&state)?;
    drop(config);
    app.emit("scancode-map-changed", ())
        .map_err(|error| error.to_string())?;
    Ok(ScancodeMapStatus {
        applied: false,
        has_external_map: false,
        requires_restart: false,
        backup_available: true,
    })
}

#[tauri::command]
fn refresh_widget_position(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let width = *state
        .widget_width
        .lock()
        .map_err(|_| "挂件宽度状态已损坏".to_string())?;
    taskbar::refresh_widget_position(&app, width);
    Ok(())
}

#[tauri::command]
fn check_is_admin() -> bool {
    admin::is_elevated()
}

#[tauri::command]
fn relaunch_as_admin(app: AppHandle) -> Result<(), String> {
    admin::relaunch_as_admin()?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn get_widget_config(state: State<'_, AppState>) -> Result<WidgetConfig, String> {
    state
        .config
        .lock()
        .map(|config| config.widget_config.clone())
        .map_err(|_| "配置状态已损坏".to_string())
}

#[tauri::command]
fn update_widget_config(
    app: AppHandle,
    state: State<'_, AppState>,
    mut config: WidgetConfig,
) -> Result<WidgetConfig, String> {
    let _mutation = state
        .mutation_lock
        .lock()
        .map_err(|_| "配置写入锁已损坏".to_string())?;
    config.refresh_interval_secs = config.refresh_interval_secs.clamp(1, 5);
    let previous_config = {
        let mut current = state
            .config
            .lock()
            .map_err(|_| "配置状态已损坏".to_string())?;
        let previous = current.clone();
        current.widget_config = config.clone();
        previous
    };
    if let Err(error) = persist(&state) {
        *state
            .config
            .lock()
            .map_err(|_| "配置状态已损坏".to_string())? = previous_config;
        return Err(error);
    }
    app.emit("widget-config-changed", &config)
        .map_err(|error| error.to_string())?;
    Ok(config)
}

#[tauri::command]
fn get_screenshot_config(state: State<'_, AppState>) -> Result<config::ScreenshotConfig, String> {
    state
        .config
        .lock()
        .map(|config| config.screenshot_config.clone())
        .map_err(|_| "配置状态已损坏".to_string())
}

#[tauri::command]
fn update_screenshot_config(
    state: State<'_, AppState>,
    mut screenshot_config: config::ScreenshotConfig,
) -> Result<config::ScreenshotConfig, String> {
    let _mutation = state
        .mutation_lock
        .lock()
        .map_err(|_| "配置写入锁已损坏".to_string())?;
    config::normalize_screenshot_config(&mut screenshot_config);
    let previous_config = {
        let mut current = state
            .config
            .lock()
            .map_err(|_| "配置状态已损坏".to_string())?;
        let previous = current.clone();
        current.screenshot_config = screenshot_config.clone();
        previous
    };
    if let Err(error) = persist(&state) {
        *state
            .config
            .lock()
            .map_err(|_| "配置状态已损坏".to_string())? = previous_config;
        return Err(error);
    }
    Ok(screenshot_config)
}

#[tauri::command]
async fn recognize_selection_onnx(
    app: AppHandle,
    image_base64: String,
) -> Result<ocr::OcrTextResult, String> {
    tokio::task::spawn_blocking(move || ocr::recognize_onnx(&app, &image_base64))
        .await
        .map_err(|error| format!("ONNX OCR 后台任务异常：{error}"))?
}

#[tauri::command]
async fn recognize_selection_rusto(
    app: AppHandle,
    image_base64: String,
) -> Result<ocr::OcrTextResult, String> {
    tokio::task::spawn_blocking(move || ocr::recognize_rusto(&app, &image_base64))
        .await
        .map_err(|error| format!("RustO OCR 后台任务异常：{error}"))?
}

#[tauri::command]
fn choose_screenshot_save_directory() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("选择截图默认保存目录")
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn sync_widget_dynamic_width(
    app: AppHandle,
    state: State<'_, AppState>,
    width: f64,
) -> Result<(), String> {
    let width = taskbar::sync_dynamic_width(&app, width);
    *state
        .widget_width
        .lock()
        .map_err(|_| "挂件宽度状态已损坏".to_string())? = width;
    Ok(())
}

#[tauri::command]
fn get_minimize_to_tray(state: State<'_, AppState>) -> Result<bool, String> {
    state
        .config
        .lock()
        .map(|config| config.minimize_to_tray)
        .map_err(|_| "配置状态已损坏".to_string())
}

#[tauri::command]
fn set_minimize_to_tray(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    let _mutation = state
        .mutation_lock
        .lock()
        .map_err(|_| "配置写入锁已损坏".to_string())?;
    let previous_config = {
        let mut config = state
            .config
            .lock()
            .map_err(|_| "配置状态已损坏".to_string())?;
        let previous = config.clone();
        config.minimize_to_tray = enabled;
        previous
    };
    if let Err(error) = persist(&state) {
        *state
            .config
            .lock()
            .map_err(|_| "配置状态已损坏".to_string())? = previous_config;
        return Err(error);
    }
    Ok(())
}

fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::with_id("show", "显示主窗口").build(app)?;
    let capture = MenuItemBuilder::with_id("capture", "截图").build(app)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let about = MenuItemBuilder::with_id("about", "关于 DockMapper").build(app)?;
    let separator2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&capture)
        .item(&separator)
        .item(&about)
        .item(&separator2)
        .item(&quit)
        .build()?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("tauri.conf.json 未配置默认窗口图标")?;

    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("DockMapper — 任务栏工具")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" | "about" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "capture" => {
                litesnap::start_capture(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .register_uri_scheme_protocol("dockmapper-shot", |_, request| {
            litesnap::serve_capture_uri(request)
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(litesnap::create_state())
        .setup(|app| {
            #[cfg(desktop)]
            setup_tray(app)?;

            let config_path = app.path().app_data_dir()?.join("config.json");
            let loaded_config = config::load(&config_path);
            let state = AppState {
                config: Mutex::new(loaded_config),
                config_path,
                widget_width: Mutex::new(DEFAULT_WIDGET_WIDTH),
                mutation_lock: Mutex::new(()),
            };
            app.manage(state);
            if let Err(error) = litesnap::initialize(app.handle()) {
                eprintln!("注册截图快捷键失败：{error}");
            }

            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let minimize = app_handle
                            .state::<AppState>()
                            .config
                            .lock()
                            .map(|config| config.minimize_to_tray)
                            .unwrap_or(true);
                        if minimize {
                            api.prevent_close();
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                    }
                });
            }

            let widget = app
                .get_webview_window("taskbar_widget")
                .ok_or("缺少 taskbar_widget 窗口")?;
            #[cfg(target_os = "windows")]
            taskbar::embed_widget_to_taskbar(&widget);

            sys_monitor::start_sys_monitor(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_supported_keys,
            get_key_mappings,
            sync_key_mappings,
            get_engine_status,
            set_engine_enabled,
            get_scancode_map_status,
            apply_scancode_map,
            restore_scancode_map,
            litesnap::start_screenshot,
            litesnap::close_overlay,
            litesnap::show_capture_overlay,
            litesnap::overlay_ready,
            litesnap::scroll_control_ready,
            litesnap::get_full_screenshot,
            litesnap::report_capture_rendered,
            litesnap::begin_scroll_capture,
            litesnap::finish_scroll_capture,
            litesnap::cancel_scroll_capture,
            litesnap::copy_image,
            litesnap::copy_text,
            litesnap::save_image,
            litesnap::pin_image,
            litesnap::get_pin_image,
            litesnap::close_pin_window,
            get_screenshot_config,
            update_screenshot_config,
            choose_screenshot_save_directory,
            recognize_selection_onnx,
            recognize_selection_rusto,
            refresh_widget_position,
            check_is_admin,
            relaunch_as_admin,
            get_widget_config,
            update_widget_config,
            sync_widget_dynamic_width,
            get_minimize_to_tray,
            set_minimize_to_tray,
        ])
        .build(tauri::generate_context!())
        .expect("构建 DockMapper 失败");

    app.run(|_, _| {});
}
