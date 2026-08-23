use super::{handle_start_capture, AppState};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

fn tauri_shortcut(value: &str) -> String {
    value
        .replace("CommandOrControl", "CmdOrCtrl")
        .replace("Command", "Cmd")
}

pub fn register(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    let previous = state
        .registered_shortcut
        .lock()
        .map_err(|_| "快捷键状态已损坏".to_string())?
        .clone();
    if previous.as_deref() == Some(shortcut) {
        return Ok(());
    }
    let native_shortcut = tauri_shortcut(shortcut);
    app.global_shortcut()
        .on_shortcut(native_shortcut.as_str(), |app, _, event| {
            if event.state() == ShortcutState::Pressed {
                handle_start_capture(app);
            }
        })
        .map_err(|error| error.to_string())?;
    if let Some(old) = previous {
        let _ = app
            .global_shortcut()
            .unregister(tauri_shortcut(&old).as_str());
    }
    *state
        .registered_shortcut
        .lock()
        .map_err(|_| "快捷键状态已损坏".to_string())? = Some(shortcut.into());
    Ok(())
}
