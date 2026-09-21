use super::*;

pub fn normalize_screenshot_config(config: &mut ScreenshotConfig) {
    config.filename_prefix = config
        .filename_prefix
        .trim()
        .chars()
        .filter(|character| {
            !matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
        })
        .take(48)
        .collect();
    if config.filename_prefix.is_empty() {
        config.filename_prefix = ScreenshotConfig::default().filename_prefix;
    }
    if config
        .save_directory
        .as_ref()
        .is_some_and(|directory| directory.trim().is_empty())
    {
        config.save_directory = None;
    }
    let color = config.annotation_color.trim();
    if color.len() == 7
        && color.starts_with('#')
        && color[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        config.annotation_color = color.to_ascii_lowercase();
    } else {
        config.annotation_color = ScreenshotConfig::default().annotation_color;
    }
    let outline_color = config.annotation_outline.color.trim();
    if outline_color.len() == 7
        && outline_color.starts_with('#')
        && outline_color[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        config.annotation_outline.color = outline_color.to_ascii_lowercase();
    } else {
        config.annotation_outline.color = AnnotationOutlineConfig::default().color;
    }
    config.annotation_outline.width = AnnotationOutlineConfig::default().width;

    if !config.annotation_styles_initialized {
        for style in [
            &mut config.annotation_styles.shape,
            &mut config.annotation_styles.line,
            &mut config.annotation_styles.arrow,
            &mut config.annotation_styles.pen,
            &mut config.annotation_styles.highlight,
            &mut config.annotation_styles.text,
        ] {
            style.stroke_color = config.annotation_color.clone();
            style.outline_enabled = config.annotation_outline.enabled;
            style.outline_color = config.annotation_outline.color.clone();
            style.outline_width = config.annotation_outline.width;
        }
        config.annotation_styles_initialized = true;
    }

    for style in [
        &mut config.annotation_styles.shape,
        &mut config.annotation_styles.line,
        &mut config.annotation_styles.arrow,
        &mut config.annotation_styles.pen,
        &mut config.annotation_styles.highlight,
        &mut config.annotation_styles.text,
        &mut config.annotation_styles.number,
        &mut config.annotation_styles.mosaic,
    ] {
        normalize_annotation_tool_style(style);
    }
    config.annotation_styles.line.fill_style = AnnotationFillStyle::None;
    config.annotation_styles.arrow.fill_style = AnnotationFillStyle::None;
    config.annotation_styles.pen.fill_style = AnnotationFillStyle::None;
    config.annotation_styles.highlight.fill_style = AnnotationFillStyle::None;
    config.annotation_styles.highlight.pressure = false;
}

pub(crate) fn normalize_annotation_tool_style(style: &mut AnnotationToolStyleConfig) {
    let fallback = AnnotationToolStyleConfig::default();
    style.stroke_color =
        normalize_hex_color(&style.stroke_color).unwrap_or_else(|| fallback.stroke_color.clone());
    style.background_color = if style.background_color.eq_ignore_ascii_case("transparent") {
        "transparent".into()
    } else {
        normalize_hex_color(&style.background_color)
            .unwrap_or_else(|| fallback.background_color.clone())
    };
    style.stroke_width = if style.stroke_width.is_finite() {
        style.stroke_width.clamp(1.0, 32.0)
    } else {
        fallback.stroke_width
    };
    style.roughness = style.roughness.min(2);
    style.opacity = if style.opacity.is_finite() {
        style.opacity.clamp(0.05, 1.0)
    } else {
        fallback.opacity
    };
    style.block_size = style.block_size.clamp(2, 64);
    style.font_size = style.font_size.clamp(8, 96);
    style.marker_size = style.marker_size.clamp(16, 64);
    style.outline_color =
        normalize_hex_color(&style.outline_color).unwrap_or_else(|| fallback.outline_color.clone());
    style.outline_width = if style.outline_width.is_finite() {
        style.outline_width.clamp(0.5, 8.0)
    } else {
        fallback.outline_width
    };
    if style.stroke_style == AnnotationStrokeStyle::Unknown {
        style.stroke_style = fallback.stroke_style;
    }
    if style.fill_style == AnnotationFillStyle::Unknown {
        style.fill_style = fallback.fill_style;
    }
    if style.arrow_type == AnnotationArrowType::Unknown {
        style.arrow_type = fallback.arrow_type;
    }
    if style.start_arrowhead == AnnotationArrowhead::Unknown {
        style.start_arrowhead = fallback.start_arrowhead;
    }
    if style.end_arrowhead == AnnotationArrowhead::Unknown {
        style.end_arrowhead = fallback.end_arrowhead;
    }
}

fn normalize_hex_color(value: &str) -> Option<String> {
    let value = value.trim();
    (value.len() == 7
        && value.starts_with('#')
        && value[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit()))
    .then(|| value.to_ascii_lowercase())
}

pub(crate) fn normalize_loaded_config(config: &mut AppConfig) {
    if let Some(legacy) = config.legacy_presentation_config.take() {
        config.key_visualizer_config.clicks = legacy.clicks;
        config.key_visualizer_config.highlight = legacy.highlight;
        config.key_visualizer_config.lock_keys = legacy.lock_keys;
    }
    config.widget_config.refresh_interval_secs =
        config.widget_config.refresh_interval_secs.clamp(1, 5);
    normalize_screenshot_config(&mut config.screenshot_config);
    normalize_palette(&mut config.color_palette);
    config.widget_config.normalize();
    normalize_key_visualizer_config(&mut config.key_visualizer_config);
}

pub fn normalize_key_visualizer_config(config: &mut KeyVisualizerConfig) {
    config.font_size = config.font_size.clamp(16, 48);
    config.scale_percent = config.scale_percent.clamp(75, 200);
    config.text_opacity = config.text_opacity.clamp(20, 100);
}

pub fn normalize_color(value: &str) -> Option<String> {
    let value = value.trim();
    let hex = value.strip_prefix('#').unwrap_or(value);
    if hex.len() != 6 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("#{hex}").to_ascii_uppercase())
}

pub fn normalize_palette(palette: &mut ColorPaletteConfig) {
    let normalize = |values: &mut Vec<String>, limit: usize| {
        let mut unique = Vec::with_capacity(values.len());
        for value in std::mem::take(values) {
            if let Some(value) = normalize_color(&value) {
                if !unique.contains(&value) {
                    unique.push(value);
                }
            }
            if unique.len() == limit {
                break;
            }
        }
        *values = unique;
    };
    normalize(&mut palette.recent, 5);
    normalize(&mut palette.favorites, 5);
}

pub fn record_palette_color(palette: &mut ColorPaletteConfig, value: &str) -> Result<(), String> {
    let color = normalize_color(value).ok_or_else(|| "颜色必须为 #RRGGBB".to_string())?;
    palette.recent.retain(|item| item != &color);
    palette.recent.insert(0, color);
    normalize_palette(palette);
    Ok(())
}

pub fn set_palette_favorite(
    palette: &mut ColorPaletteConfig,
    value: &str,
    favorite: bool,
) -> Result<(), String> {
    let color = normalize_color(value).ok_or_else(|| "颜色必须为 #RRGGBB".to_string())?;
    palette.favorites.retain(|item| item != &color);
    if favorite {
        palette.favorites.insert(0, color);
    }
    normalize_palette(palette);
    Ok(())
}

pub fn clear_recent_palette(palette: &mut ColorPaletteConfig) {
    palette.recent.clear();
}
