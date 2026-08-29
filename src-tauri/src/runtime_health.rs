use crate::{screenshot, AppState};
use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealth {
    screenshot: screenshot::RuntimeStatus,
    history_count: usize,
    transient_image_count: usize,
    transient_image_bytes: usize,
}

#[tauri::command]
pub async fn get_runtime_health(app: AppHandle) -> Result<RuntimeHealth, String> {
    let screenshot = screenshot::runtime_status(&app)?;
    let state = app.state::<AppState>();
    let (transient_image_count, transient_image_bytes) = state.images.stats()?;
    Ok(RuntimeHealth {
        screenshot,
        history_count: state.history.count(),
        transient_image_count,
        transient_image_bytes,
    })
}
