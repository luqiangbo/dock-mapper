use crate::{commit_shortcut_change_with, persist};
use crate::{config, diagnostics, ocr, screenshot, AppState};
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn get_screenshot_config(
    state: State<'_, AppState>,
) -> Result<config::ScreenshotConfig, String> {
    state
        .config
        .lock()
        .map(|config| config.screenshot_config.clone())
        .map_err(|_| "配置状态已损坏".to_string())
}

#[tauri::command]
pub fn update_screenshot_config(
    app: AppHandle,
    state: State<'_, AppState>,
    screenshot_config: config::ScreenshotConfig,
) -> Result<config::ScreenshotConfig, String> {
    update_screenshot_config_impl(&app, &state, screenshot_config)
}

fn preserve_overlay_owned_screenshot_fields(
    current: &config::ScreenshotConfig,
    requested: &mut config::ScreenshotConfig,
) {
    requested.annotation_color = current.annotation_color.clone();
    requested.annotation_outline = current.annotation_outline.clone();
    requested.annotation_styles = current.annotation_styles.clone();
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
    let previous_config = state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())?
        .clone();
    // This endpoint edits the settings-page fields. Annotation visuals are
    // owned by focused overlay mutations so a stale settings form cannot
    // overwrite values picked in another window.
    preserve_overlay_owned_screenshot_fields(
        &previous_config.screenshot_config,
        &mut screenshot_config,
    );
    config::normalize_screenshot_config(&mut screenshot_config);
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
pub fn update_screenshot_annotation_color(
    state: State<'_, AppState>,
    color: String,
) -> Result<String, String> {
    let _mutation = state
        .mutation_lock
        .lock()
        .map_err(|_| "配置写入锁已损坏".to_string())?;
    let mut next = state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())?
        .clone();
    next.screenshot_config.annotation_color = color;
    config::normalize_screenshot_config(&mut next.screenshot_config);
    let normalized_color = next.screenshot_config.annotation_color.clone();
    for style in [
        &mut next.screenshot_config.annotation_styles.shape,
        &mut next.screenshot_config.annotation_styles.line,
        &mut next.screenshot_config.annotation_styles.arrow,
        &mut next.screenshot_config.annotation_styles.pen,
        &mut next.screenshot_config.annotation_styles.highlight,
    ] {
        style.stroke_color = normalized_color.clone();
    }
    config::save(&state.config_path, &next)?;
    let normalized = next.screenshot_config.annotation_color.clone();
    *state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())? = next;
    Ok(normalized)
}

#[tauri::command]
pub fn update_screenshot_annotation_outline(
    state: State<'_, AppState>,
    outline: config::AnnotationOutlineConfig,
) -> Result<config::AnnotationOutlineConfig, String> {
    let _mutation = state
        .mutation_lock
        .lock()
        .map_err(|_| "配置写入锁已损坏".to_string())?;
    let mut next = state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())?
        .clone();
    next.screenshot_config.annotation_outline = outline;
    config::normalize_screenshot_config(&mut next.screenshot_config);
    let normalized_outline = next.screenshot_config.annotation_outline.clone();
    for style in [
        &mut next.screenshot_config.annotation_styles.shape,
        &mut next.screenshot_config.annotation_styles.line,
        &mut next.screenshot_config.annotation_styles.arrow,
        &mut next.screenshot_config.annotation_styles.pen,
        &mut next.screenshot_config.annotation_styles.highlight,
        &mut next.screenshot_config.annotation_styles.text,
        &mut next.screenshot_config.annotation_styles.number,
    ] {
        style.outline_enabled = normalized_outline.enabled;
        style.outline_color = normalized_outline.color.clone();
        style.outline_width = normalized_outline.width;
    }
    config::save(&state.config_path, &next)?;
    let normalized = next.screenshot_config.annotation_outline.clone();
    *state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())? = next;
    Ok(normalized)
}

#[tauri::command]
pub fn update_screenshot_annotation_styles(
    state: State<'_, AppState>,
    styles: config::ScreenshotAnnotationStyles,
) -> Result<config::ScreenshotAnnotationStyles, String> {
    let _mutation = state
        .mutation_lock
        .lock()
        .map_err(|_| "配置写入锁已损坏".to_string())?;
    let mut next = state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())?
        .clone();
    next.screenshot_config.annotation_styles = styles;
    config::normalize_screenshot_config(&mut next.screenshot_config);
    // Keep a useful fallback for older DockMapper versions.
    next.screenshot_config.annotation_color = next
        .screenshot_config
        .annotation_styles
        .shape
        .stroke_color
        .clone();
    next.screenshot_config.annotation_outline = config::AnnotationOutlineConfig {
        enabled: next.screenshot_config.annotation_styles.shape.outline_enabled,
        color: next.screenshot_config.annotation_styles.shape.outline_color.clone(),
        width: next.screenshot_config.annotation_styles.shape.outline_width,
    };
    config::save(&state.config_path, &next)?;
    let normalized = next.screenshot_config.annotation_styles.clone();
    *state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())? = next;
    Ok(normalized)
}

#[tauri::command]
pub fn get_screenshot_shortcut_statuses(
    app: AppHandle,
) -> Result<Vec<screenshot::ShortcutRuntimeStatus>, String> {
    screenshot::shortcut_statuses(&app)
}

#[tauri::command]
pub fn reset_screenshot_shortcuts(
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
pub async fn recognize_selection(
    state: State<'_, AppState>,
    service: State<'_, ocr::OcrService>,
    image_id: String,
) -> Result<ocr::OcrTextResult, String> {
    let png = state.images.take(&image_id)?;
    service.recognize(png.as_ref().to_vec()).await
}

#[tauri::command]
pub fn get_color_palette(state: State<'_, AppState>) -> Result<config::ColorPaletteConfig, String> {
    state
        .config
        .lock()
        .map(|config| config.color_palette.clone())
        .map_err(|_| "配置状态已损坏".to_string())
}

fn mutate_palette(
    state: &AppState,
    change: impl FnOnce(&mut config::ColorPaletteConfig) -> Result<(), String>,
) -> Result<config::ColorPaletteConfig, String> {
    let _mutation = state
        .mutation_lock
        .lock()
        .map_err(|_| "配置写入锁已损坏".to_string())?;
    let previous = state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())?
        .clone();
    let mut next = previous.clone();
    change(&mut next.color_palette)?;
    config::normalize_palette(&mut next.color_palette);
    config::save(&state.config_path, &next)?;
    *state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏".to_string())? = next.clone();
    Ok(next.color_palette)
}

#[tauri::command]
pub fn record_palette_color(
    app: AppHandle,
    state: State<'_, AppState>,
    color: String,
) -> Result<config::ColorPaletteConfig, String> {
    let palette = mutate_palette(&state, |palette| {
        config::record_palette_color(palette, &color)
    })?;
    let _ = app.emit("color-palette-changed", &palette);
    Ok(palette)
}

#[tauri::command]
pub fn set_palette_favorite(
    app: AppHandle,
    state: State<'_, AppState>,
    color: String,
    favorite: bool,
) -> Result<config::ColorPaletteConfig, String> {
    let palette = mutate_palette(&state, |palette| {
        config::set_palette_favorite(palette, &color, favorite)
    })?;
    let _ = app.emit("color-palette-changed", &palette);
    Ok(palette)
}

#[tauri::command]
pub fn clear_recent_palette(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<config::ColorPaletteConfig, String> {
    let palette = mutate_palette(&state, |palette| {
        config::clear_recent_palette(palette);
        Ok(())
    })?;
    let _ = app.emit("color-palette-changed", &palette);
    Ok(palette)
}

#[tauri::command]
pub async fn decode_qr_selection(
    state: State<'_, AppState>,
    image_id: String,
) -> Result<ocr::QrDecodeResult, String> {
    let png = state.images.take(&image_id)?;
    tokio::task::spawn_blocking(move || ocr::decode_qr(png.as_ref().to_vec()))
        .await
        .map_err(|error| format!("二维码解码后台任务异常：{error}"))?
}

#[tauri::command]
pub fn choose_screenshot_save_directory() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("选择截图默认保存目录")
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn export_diagnostics(
    app: AppHandle,
    state: State<'_, AppState>,
    diagnostics: State<'_, diagnostics::DiagnosticsState>,
) -> Result<Option<String>, String> {
    diagnostics::export(&app, state, diagnostics)
}

#[tauri::command]
pub fn get_minimize_to_tray(state: State<'_, AppState>) -> Result<bool, String> {
    state
        .config
        .lock()
        .map(|config| config.minimize_to_tray)
        .map_err(|_| "配置状态已损坏".to_string())
}

#[tauri::command]
pub fn set_minimize_to_tray(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_settings_form_cannot_replace_overlay_annotation_visuals() {
        let current = config::ScreenshotConfig {
            annotation_color: "#1971c2".into(),
            annotation_outline: config::AnnotationOutlineConfig {
                enabled: false,
                color: "#000000".into(),
                width: 4.0,
            },
            ..config::ScreenshotConfig::default()
        };
        let mut requested = config::ScreenshotConfig {
            annotation_color: "#e03131".into(),
            filename_prefix: "changed".into(),
            ..config::ScreenshotConfig::default()
        };

        preserve_overlay_owned_screenshot_fields(&current, &mut requested);

        assert_eq!(requested.annotation_color, "#1971c2");
        assert_eq!(requested.annotation_outline, current.annotation_outline);
        assert_eq!(requested.annotation_styles, current.annotation_styles);
        assert_eq!(requested.filename_prefix, "changed");
    }
}
