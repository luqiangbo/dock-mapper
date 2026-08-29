use super::*;

#[tauri::command]
pub fn copy_text(value: String) -> Result<bool, String> {
    clipboard::write_text(value)?;
    Ok(true)
}

pub(super) fn remember_confirmed_image(app: &AppHandle, data: Arc<[u8]>) {
    *app.state::<AppState>().confirmed_png.lock_or_recover() = Some(data);
}

pub(super) fn confirmed_image(state: &AppState) -> Result<Arc<[u8]>, String> {
    state
        .confirmed_png
        .lock_or_recover()
        .clone()
        .ok_or_else(|| "没有已确认的选区截图，请先按 Ctrl+1 框选并确认。".to_string())
}

pub(super) fn pin_confirmed_image(app: &AppHandle) -> Result<bool, String> {
    let data = confirmed_image(&app.state::<AppState>())?;
    pin_image_impl(app.clone(), data, true).map(|_| true)
}

pub fn copy_png_bytes(data: &[u8]) -> Result<(), String> {
    clipboard::write_png(data)
}

pub fn pin_external_image(app: AppHandle, data: Vec<u8>) -> Result<String, String> {
    pin_image_impl(app, Arc::from(data.into_boxed_slice()), false)
}

#[tauri::command]
pub fn copy_image(
    app: AppHandle,
    config_state: State<'_, crate::AppState>,
    image_id: String,
) -> Result<bool, String> {
    let data = config_state.images.take(&image_id)?;
    hide_overlay_for_commit(&app);
    if let Err(error) = clipboard::write_png(&data) {
        restore_overlay_after_commit_failure(&app);
        return Err(error);
    }
    remember_confirmed_image(&app, data);
    finish_overlay_commit(&app);
    Ok(true)
}

#[tauri::command]
pub fn save_image(
    app: AppHandle,
    config_state: State<'_, crate::AppState>,
    image_id: String,
) -> Result<bool, String> {
    let data = config_state.images.take(&image_id)?;
    hide_overlay_for_commit(&app);
    if let Err(error) = clipboard::write_png(&data) {
        restore_overlay_after_commit_failure(&app);
        return Err(error);
    }
    remember_confirmed_image(&app, data.clone());
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
    if let Err(error) = fs::write(path, data.as_ref()) {
        restore_overlay_after_commit_failure(&app);
        return Err(error.to_string());
    }
    finish_overlay_commit(&app);
    Ok(true)
}

#[tauri::command]
pub fn copy_pin_image(state: State<AppState>, id: String) -> Result<bool, String> {
    let data = state
        .pin_runtime
        .lock_or_recover()
        .data
        .get(&id)
        .cloned()
        .ok_or_else(|| "贴图数据不存在".to_string())?;
    clipboard::write_png(&data)?;
    Ok(true)
}

#[tauri::command]
pub fn save_pin_image(state: State<AppState>, id: String) -> Result<bool, String> {
    let data = state
        .pin_runtime
        .lock_or_recover()
        .data
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
    fs::write(path, data.as_ref()).map_err(|error| error.to_string())?;
    Ok(true)
}
