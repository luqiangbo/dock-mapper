use crate::{history, screenshot, AppState};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

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
pub async fn list_screenshot_history(
    state: State<'_, AppState>,
) -> Result<Vec<history::ScreenshotHistorySummary>, String> {
    let history = Arc::clone(&state.history);
    run_history_task(move || history.list()).await
}

#[tauri::command]
pub async fn get_screenshot_history_image(
    state: State<'_, AppState>,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    let history = Arc::clone(&state.history);
    let image = run_history_task(move || history.image(&id)).await?;
    Ok(tauri::ipc::Response::new(image))
}

#[tauri::command]
pub async fn get_screenshot_history_thumbnail(
    state: State<'_, AppState>,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    let history = Arc::clone(&state.history);
    let thumbnail = run_history_task(move || history.thumbnail(&id)).await?;
    Ok(tauri::ipc::Response::new(thumbnail))
}

#[tauri::command]
pub async fn create_screenshot_history(
    app: AppHandle,
    state: State<'_, AppState>,
    result_image_id: String,
) -> Result<history::ScreenshotHistorySummary, String> {
    let result = match state.images.get(&result_image_id) {
        Ok(image) => {
            let history = Arc::clone(&state.history);
            run_history_task(move || history.create(&image)).await
        }
        Err(error) => Err(error),
    };
    match result {
        Ok(summary) => {
            app.state::<AppState>().images.remove(&result_image_id);
            let _ = app.emit("screenshot-history-changed", ());
            Ok(summary)
        }
        Err(error) => {
            let _ = app.emit("screenshot-history-write-failed", &error);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn set_screenshot_history_favorite(
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
pub async fn delete_screenshot_history(
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
pub async fn copy_screenshot_history(
    state: State<'_, AppState>,
    id: String,
) -> Result<bool, String> {
    let history = Arc::clone(&state.history);
    run_history_task(move || {
        let data = history.image(&id)?;
        screenshot::copy_png_bytes(&data)?;
        Ok(true)
    })
    .await
}

#[tauri::command]
pub async fn pin_screenshot_history(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<String, String> {
    let history = Arc::clone(&state.history);
    let data = run_history_task(move || history.image(&id)).await?;
    screenshot::pin_external_image(app, data)
}
