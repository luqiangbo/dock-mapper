use crate::{config, scancode_mapper};

pub(crate) fn commit_scancode_change_with<W, S>(
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

pub(crate) fn commit_scancode_change_at_path(
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

pub(crate) fn commit_shortcut_change_with<A, S>(
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
        || previous_shortcuts.toggle_pin_shortcut != next_shortcuts.toggle_pin_shortcut
        || previous_shortcuts.quick_ocr_shortcut != next_shortcuts.quick_ocr_shortcut;
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
