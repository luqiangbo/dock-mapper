mod admin;
mod config;
mod diagnostics;
mod dxgi_capture;
mod history;
mod image_store;
mod key_mapping;
mod ocr;
mod runtime_health;
mod scancode_mapper;
mod screenshot;
mod sys_monitor;
mod taskbar;
mod tray;
mod widget;

use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        atomic::AtomicBool,
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, State};

pub use widget::{MemoryScheme, UsageScheme, WidgetConfig, WidgetMetricConfig, WidgetMetricKind};
pub use key_mapping::{ScancodeMapState, ScancodeMapStatus};

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

pub struct AppState {
    pub config: Mutex<config::AppConfig>,
    pub images: image_store::ImageStore,
    pub history: Arc<history::HistoryStore>,
    config_path: PathBuf,
    widget_width: Mutex<f64>,
    mutation_lock: Mutex<()>,
    admin_operation_in_progress: AtomicBool,
}

#[tauri::command]
fn upload_image(
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("图片上传必须使用原始二进制请求".into());
    };
    state.images.insert(bytes.clone())
}

#[tauri::command]
fn release_image(state: State<'_, AppState>, image_id: String) {
    state.images.remove(&image_id);
}

async fn run_history_task<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|error| format!("截图历史后台任务失败：{error}"))?
}

#[tauri::command]
async fn list_screenshot_history(
    state: State<'_, AppState>,
) -> Result<Vec<history::ScreenshotHistorySummary>, String> {
    let history = Arc::clone(&state.history);
    run_history_task(move || history.list()).await
}

#[tauri::command]
async fn get_screenshot_history_image(
    state: State<'_, AppState>,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    let history = Arc::clone(&state.history);
    let image = run_history_task(move || history.image(&id)).await?;
    Ok(tauri::ipc::Response::new(image))
}

#[tauri::command]
async fn get_screenshot_history_thumbnail(
    state: State<'_, AppState>,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    let history = Arc::clone(&state.history);
    let thumbnail = run_history_task(move || history.thumbnail(&id)).await?;
    Ok(tauri::ipc::Response::new(thumbnail))
}

#[tauri::command]
async fn create_screenshot_history(
    app: AppHandle,
    state: State<'_, AppState>,
    result_image_id: String,
) -> Result<history::ScreenshotHistorySummary, String> {
    let result = state.images.get(&result_image_id)?;
    let history = Arc::clone(&state.history);
    let summary = run_history_task(move || history.create(&result)).await?;
    app.state::<AppState>().images.remove(&result_image_id);
    let _ = app.emit("screenshot-history-changed", ());
    Ok(summary)
}

#[tauri::command]
async fn set_screenshot_history_favorite(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    favorite: bool,
) -> Result<history::ScreenshotHistorySummary, String> {
    let history = Arc::clone(&state.history);
    let summary = run_history_task(move || history.set_favorite(&id, favorite)).await?;
    let _ = app.emit("screenshot-history-changed", ());
    Ok(summary)
}

#[tauri::command]
async fn delete_screenshot_history(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<bool, String> {
    let history = Arc::clone(&state.history);
    let deleted = run_history_task(move || history.delete(&id)).await?;
    if deleted {
        let _ = app.emit("screenshot-history-changed", ());
    }
    Ok(deleted)
}

#[tauri::command]
async fn copy_screenshot_history(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    let history = Arc::clone(&state.history);
    run_history_task(move || {
        let data = history.image(&id)?;
        screenshot::copy_png_bytes(&data)?;
        Ok(true)
    })
    .await
}

#[tauri::command]
async fn pin_screenshot_history(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    let history = Arc::clone(&state.history);
    let data = run_history_task(move || history.image(&id)).await?;
    screenshot::pin_external_image(app, data)
}

fn persist(state: &AppState) -> Result<(), String> {
    let config = state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())?
        .clone();
    config::save(&state.config_path, &config)
}

fn commit_scancode_change_with<W, S>(
    registry_before: Option<&[u8]>,
    registry_after: Option<&[u8]>,
    next_config: &config::AppConfig,
    mut write_registry: W,
    save_config: S,
) -> Result<(), String>
where
    W: FnMut(Option<&[u8]>) -> Result<(), String>,
    S: FnOnce(&config::AppConfig) -> Result<(), String>,
{
    write_registry(registry_after)?;
    if let Err(save_error) = save_config(next_config) {
        return match write_registry(registry_before) {
            Ok(()) => Err(save_error),
            Err(rollback_error) => Err(format!(
                "{save_error}；同时回滚系统键盘映射失败：{rollback_error}"
            )),
        };
    }
    Ok(())
}

fn commit_scancode_change_at_path(
    config_path: &std::path::Path,
    registry_before: Option<&[u8]>,
    registry_after: Option<&[u8]>,
    next_config: &config::AppConfig,
) -> Result<(), String> {
    commit_scancode_change_with(
        registry_before,
        registry_after,
        next_config,
        scancode_mapper::write,
        |config| config::save(config_path, config),
    )
}

fn commit_shortcut_change_with<A, S>(
    previous_shortcuts: &config::ScreenshotConfig,
    next_shortcuts: &config::ScreenshotConfig,
    next_config: &config::AppConfig,
    mut apply: A,
    save: S,
) -> Result<(), String>
where
    A: FnMut(&config::ScreenshotConfig, &config::ScreenshotConfig) -> Result<(), String>,
    S: FnOnce(&config::AppConfig) -> Result<(), String>,
{
    let shortcuts_changed = previous_shortcuts.shortcut != next_shortcuts.shortcut
        || previous_shortcuts.pin_shortcut != next_shortcuts.pin_shortcut
        || previous_shortcuts.history_shortcut != next_shortcuts.history_shortcut
        || previous_shortcuts.toggle_pin_shortcut != next_shortcuts.toggle_pin_shortcut;
    if shortcuts_changed {
        apply(previous_shortcuts, next_shortcuts)?;
    }
    if let Err(save_error) = save(next_config) {
        if !shortcuts_changed {
            return Err(save_error);
        }
        return match apply(next_shortcuts, previous_shortcuts) {
            Ok(()) => Err(save_error),
            Err(rollback) => Err(format!("{save_error}；同时恢复快捷键失败：{rollback}")),
        };
    }
    Ok(())
}

fn supported_keys() -> Vec<SupportedKey> {
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
fn get_screenshot_config(state: State<'_, AppState>) -> Result<config::ScreenshotConfig, String> {
    state
        .config
        .lock()
        .map(|config| config.screenshot_config.clone())
        .map_err(|_| "配置状态已损坏".to_string())
}

#[tauri::command]
fn update_screenshot_config(
    app: AppHandle,
    state: State<'_, AppState>,
    screenshot_config: config::ScreenshotConfig,
) -> Result<config::ScreenshotConfig, String> {
    update_screenshot_config_impl(&app, &state, screenshot_config)
}

fn update_screenshot_config_impl(
    app: &AppHandle,
    state: &AppState,
    mut screenshot_config: config::ScreenshotConfig,
) -> Result<config::ScreenshotConfig, String> {
    let _mutation = state
        .mutation_lock
        .lock()
        .map_err(|_| "配置写入锁已损坏".to_string())?;
    config::normalize_screenshot_config(&mut screenshot_config);
    let previous_config = state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())?
        .clone();
    let mut next_config = previous_config.clone();
    next_config.screenshot_config = screenshot_config.clone();
    let result = commit_shortcut_change_with(
        &previous_config.screenshot_config,
        &screenshot_config,
        &next_config,
        |previous, next| screenshot::update_shortcuts(app, previous, next),
        |config| config::save(&state.config_path, config),
    );
    let _ = app.emit("shortcut-status-changed", ());
    result?;
    *state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())? = next_config;
    Ok(screenshot_config)
}

#[tauri::command]
fn get_screenshot_shortcut_statuses(
    app: AppHandle,
) -> Result<Vec<screenshot::ShortcutRuntimeStatus>, String> {
    screenshot::shortcut_statuses(&app)
}

#[tauri::command]
fn reset_screenshot_shortcuts(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<config::ScreenshotConfig, String> {
    let _mutation = state
        .mutation_lock
        .lock()
        .map_err(|_| "配置写入锁已损坏".to_string())?;
    let previous_config = state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())?
        .clone();
    let mut next = previous_config.screenshot_config.clone();
    let defaults = config::ScreenshotConfig::default();
    next.shortcut = defaults.shortcut;
    next.pin_shortcut = defaults.pin_shortcut;
    next.history_shortcut = defaults.history_shortcut;
    next.toggle_pin_shortcut = defaults.toggle_pin_shortcut;
    next.quick_ocr_shortcut = defaults.quick_ocr_shortcut;
    let mut next_config = previous_config.clone();
    next_config.screenshot_config = next.clone();
    let result = screenshot::replace_all_shortcuts(&app, &next).and_then(|()| {
        config::save(&state.config_path, &next_config).map_err(|save_error| {
            match screenshot::replace_all_shortcuts(&app, &previous_config.screenshot_config) {
                Ok(()) => save_error,
                Err(rollback) => format!("{save_error}；同时恢复快捷键失败：{rollback}"),
            }
        })
    });
    let _ = app.emit("shortcut-status-changed", ());
    result?;
    *state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())? = next_config;
    Ok(next)
}

#[tauri::command]
async fn recognize_selection(
    state: State<'_, AppState>,
    service: State<'_, ocr::OcrService>,
    image_id: String,
) -> Result<ocr::OcrTextResult, String> {
    let png = state.images.take(&image_id)?;
    service.recognize(png.as_ref().to_vec()).await
}

#[tauri::command]
fn get_color_palette(state: State<'_, AppState>) -> Result<config::ColorPaletteConfig, String> {
    state.config.lock().map(|config| config.color_palette.clone()).map_err(|_| "配置状态已损坏".to_string())
}

fn mutate_palette(
    state: &AppState,
    change: impl FnOnce(&mut config::ColorPaletteConfig) -> Result<(), String>,
) -> Result<config::ColorPaletteConfig, String> {
    let _mutation = state.mutation_lock.lock().map_err(|_| "配置写入锁已损坏".to_string())?;
    let previous = state.config.lock().map_err(|_| "配置状态已损坏".to_string())?.clone();
    let mut next = previous.clone();
    change(&mut next.color_palette)?;
    config::normalize_palette(&mut next.color_palette);
    config::save(&state.config_path, &next)?;
    *state.config.lock().map_err(|_| "配置状态已损坏".to_string())? = next.clone();
    Ok(next.color_palette)
}

#[tauri::command]
fn record_palette_color(app: AppHandle, state: State<'_, AppState>, color: String) -> Result<config::ColorPaletteConfig, String> {
    let palette = mutate_palette(&state, |palette| {
        config::record_palette_color(palette, &color)
    })?;
    let _ = app.emit("color-palette-changed", &palette);
    Ok(palette)
}

#[tauri::command]
fn set_palette_favorite(app: AppHandle, state: State<'_, AppState>, color: String, favorite: bool) -> Result<config::ColorPaletteConfig, String> {
    let palette = mutate_palette(&state, |palette| {
        config::set_palette_favorite(palette, &color, favorite)
    })?;
    let _ = app.emit("color-palette-changed", &palette);
    Ok(palette)
}

#[tauri::command]
fn clear_recent_palette(app: AppHandle, state: State<'_, AppState>) -> Result<config::ColorPaletteConfig, String> {
    let palette = mutate_palette(&state, |palette| {
        config::clear_recent_palette(palette);
        Ok(())
    })?;
    let _ = app.emit("color-palette-changed", &palette);
    Ok(palette)
}

#[tauri::command]
async fn decode_qr_selection(
    state: State<'_, AppState>,
    image_id: String,
) -> Result<ocr::QrDecodeResult, String> {
    let png = state.images.take(&image_id)?;
    tokio::task::spawn_blocking(move || ocr::decode_qr(png.as_ref().to_vec()))
        .await
        .map_err(|error| format!("二维码解码后台任务异常：{error}"))?
}

#[tauri::command]
fn choose_screenshot_save_directory() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("选择截图默认保存目录")
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn export_diagnostics(
    app: AppHandle,
    state: State<'_, AppState>,
    diagnostics: State<'_, diagnostics::DiagnosticsState>,
) -> Result<Option<String>, String> {
    diagnostics::export(&app, state, diagnostics)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Some(exit_code) = admin::helper_exit_code_from_args(std::env::args()) {
        std::process::exit(exit_code);
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            screenshot::show_main_window(app);
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filter(|label| label == "main")
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .register_uri_scheme_protocol("dockmapper-shot", |_, request| {
            screenshot::serve_capture_uri(request)
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(screenshot::create_state())
        .setup(|app| {
            app.manage(diagnostics::initialize(app.handle())?);
            #[cfg(desktop)]
            tray::setup(app)?;

            let app_data_dir = app.path().app_data_dir()?;
            let config_path = app_data_dir.join("config.json");
            let loaded_config = config::load(&config_path);
            let history = Arc::new(history::HistoryStore::new(app_data_dir.join("history"))?);
            let monitor_interval = loaded_config.widget_config.refresh_interval_secs;
            let monitor_interface = loaded_config.widget_config.network_interface.clone();
            let state = AppState {
                config: Mutex::new(loaded_config),
                images: image_store::ImageStore::default(),
                history,
                config_path,
                widget_width: Mutex::new(widget::DEFAULT_WIDTH),
                mutation_lock: Mutex::new(()),
                admin_operation_in_progress: AtomicBool::new(false),
            };
            app.manage(state);
            app.manage(sys_monitor::SysMonitorControl::new(
                monitor_interval,
                monitor_interface,
            ));
            app.manage(ocr::OcrService::new(app.handle())?);
            if let Err(error) = screenshot::initialize(app.handle()) {
                tracing::error!(target: "dock_mapper::shortcut", %error, "注册截图快捷键失败");
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

            widget::setup_window(app)?;

            sys_monitor::start_sys_monitor(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            key_mapping::get_supported_keys,
            key_mapping::get_key_mappings,
            key_mapping::sync_key_mappings,
            key_mapping::get_scancode_map_status,
            key_mapping::apply_scancode_map,
            key_mapping::restore_scancode_map,
            upload_image,
            release_image,
            list_screenshot_history,
            get_screenshot_history_image,
            get_screenshot_history_thumbnail,
            create_screenshot_history,
            set_screenshot_history_favorite,
            delete_screenshot_history,
            copy_screenshot_history,
            pin_screenshot_history,
            runtime_health::get_runtime_health,
            screenshot::start_screenshot,
            screenshot::start_quick_ocr,
            screenshot::close_overlay,
            screenshot::show_capture_overlay,
            screenshot::overlay_ready,
            screenshot::get_full_screenshot,
            screenshot::report_capture_rendered,
            screenshot::check_screen_permission,
            screenshot::output::copy_image,
            screenshot::output::copy_text,
            screenshot::output::save_image,
            screenshot::pin_image,
            screenshot::get_pin_image,
            screenshot::pin_image_ready,
            screenshot::get_pin_options,
            screenshot::update_pin_options,
            screenshot::output::copy_pin_image,
            screenshot::output::save_pin_image,
            screenshot::close_pin_window,
            screenshot::scale_pin_window,
            screenshot::open_url,
            get_screenshot_config,
            update_screenshot_config,
            get_screenshot_shortcut_statuses,
            reset_screenshot_shortcuts,
            choose_screenshot_save_directory,
            export_diagnostics,
            recognize_selection,
            get_color_palette,
            record_palette_color,
            set_palette_favorite,
            clear_recent_palette,
            decode_qr_selection,
            widget::refresh_widget_position,
            widget::get_widget_config,
            widget::get_network_interfaces,
            widget::update_widget_config,
            widget::sync_widget_dynamic_width,
            get_minimize_to_tray,
            set_minimize_to_tray,
        ])
        .build(tauri::generate_context!())
        .expect("构建 DockMapper 失败");

    app.run(|app, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            if let Some(control) = app.try_state::<sys_monitor::SysMonitorControl>() {
                control.shutdown();
            }
        }
    });
}

#[cfg(test)]
mod transaction_tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn shortcut_transaction_restores_previous_registration_when_save_fails() {
        let registrations = Mutex::new(Vec::new());
        let config = config::AppConfig::default();
        let previous = config.screenshot_config.clone();
        let next = config::ScreenshotConfig {
            shortcut: "Control+Shift+1".into(),
            history_shortcut: "Control+Shift+3".into(),
            ..previous.clone()
        };
        let result = commit_shortcut_change_with(
            &previous,
            &next,
            &config,
            |from, to| {
                registrations.lock().unwrap().push(format!(
                    "{}+{} -> {}+{}",
                    from.shortcut, from.history_shortcut, to.shortcut, to.history_shortcut
                ));
                Ok(())
            },
            |_| Err("保存失败".into()),
        );
        assert_eq!(result.unwrap_err(), "保存失败");
        assert_eq!(
            *registrations.lock().unwrap(),
            vec![
                "Control+1+Control+3 -> Control+Shift+1+Control+Shift+3",
                "Control+Shift+1+Control+Shift+3 -> Control+1+Control+3"
            ]
        );
    }

    #[test]
    fn shortcut_transaction_does_not_save_after_registration_failure() {
        let registrations = Mutex::new(0_u8);
        let saved = Mutex::new(false);
        let config = config::AppConfig::default();
        let previous = config.screenshot_config.clone();
        let next = config::ScreenshotConfig {
            toggle_pin_shortcut: "Control+Alt+L".into(),
            ..previous.clone()
        };
        let result = commit_shortcut_change_with(
            &previous,
            &next,
            &config,
            |_, _| {
                *registrations.lock().unwrap() += 1;
                Err("快捷键已占用".into())
            },
            |_| {
                *saved.lock().unwrap() = true;
                Ok(())
            },
        );
        assert_eq!(result.unwrap_err(), "快捷键已占用");
        assert_eq!(*registrations.lock().unwrap(), 1);
        assert!(!*saved.lock().unwrap());
    }

    #[test]
    fn shortcut_transaction_does_not_reregister_unchanged_hotkeys() {
        let registrations = Mutex::new(Vec::<String>::new());
        let config = config::AppConfig::default();
        commit_shortcut_change_with(
            &config.screenshot_config,
            &config.screenshot_config,
            &config,
            |_, _| {
                registrations.lock().unwrap().push("changed".into());
                Ok(())
            },
            |_| Ok(()),
        )
        .unwrap();
        assert!(registrations.lock().unwrap().is_empty());
    }

    #[test]
    fn scancode_transaction_commits_registry_and_config_once() {
        let writes = Mutex::new(Vec::<Option<Vec<u8>>>::new());
        let saved = Mutex::new(0_u8);
        let config = config::AppConfig::default();
        commit_scancode_change_with(
            None,
            Some(&[3, 4]),
            &config,
            |value| {
                writes.lock().unwrap().push(value.map(<[u8]>::to_vec));
                Ok(())
            },
            |_| {
                *saved.lock().unwrap() += 1;
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(*writes.lock().unwrap(), vec![Some(vec![3, 4])]);
        assert_eq!(*saved.lock().unwrap(), 1);
    }

    #[test]
    fn scancode_transaction_does_not_save_after_registry_write_failure() {
        let saved = Mutex::new(false);
        let config = config::AppConfig::default();
        let result = commit_scancode_change_with(
            None,
            Some(&[3, 4]),
            &config,
            |_| Err("注册表拒绝访问".into()),
            |_| {
                *saved.lock().unwrap() = true;
                Ok(())
            },
        );
        assert_eq!(result.unwrap_err(), "注册表拒绝访问");
        assert!(!*saved.lock().unwrap());
    }

    #[test]
    fn scancode_transaction_rolls_registry_back_when_config_save_fails() {
        let writes = Mutex::new(Vec::<Option<Vec<u8>>>::new());
        let config = config::AppConfig::default();
        let result = commit_scancode_change_with(
            Some(&[1, 2]),
            Some(&[3, 4]),
            &config,
            |value| {
                writes.lock().unwrap().push(value.map(<[u8]>::to_vec));
                Ok(())
            },
            |_| Err("磁盘已满".into()),
        );

        assert_eq!(result.unwrap_err(), "磁盘已满");
        assert_eq!(
            *writes.lock().unwrap(),
            vec![Some(vec![3, 4]), Some(vec![1, 2])]
        );
    }

    #[test]
    fn scancode_transaction_reports_a_failed_rollback() {
        let calls = Mutex::new(0_u8);
        let config = config::AppConfig::default();
        let result = commit_scancode_change_with(
            None,
            Some(&[3, 4]),
            &config,
            |_| {
                let mut calls = calls.lock().unwrap();
                *calls += 1;
                if *calls == 2 {
                    Err("注册表拒绝访问".into())
                } else {
                    Ok(())
                }
            },
            |_| Err("磁盘已满".into()),
        );

        assert_eq!(
            result.unwrap_err(),
            "磁盘已满；同时回滚系统键盘映射失败：注册表拒绝访问"
        );
    }
}
