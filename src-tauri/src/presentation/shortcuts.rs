use super::*;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub(super) fn validate(config: &PresentationConfig) -> Result<(), String> {
    let toggle: Shortcut = config
        .toggle_shortcut
        .parse()
        .map_err(|e| format!("演示快捷键无效：{e}"))?;
    let locate: Shortcut = config
        .locate_shortcut
        .parse()
        .map_err(|e| format!("定位快捷键无效：{e}"))?;
    if toggle == locate {
        return Err("演示和定位快捷键不能相同".into());
    }
    Ok(())
}

fn register(app: &AppHandle, value: &str, locate: bool) -> Result<(), String> {
    if app.global_shortcut().is_registered(value) {
        return Err(format!("快捷键 {value} 已被应用内其他功能使用"));
    }
    app.global_shortcut()
        .on_shortcut(value, move |app, _, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if locate {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let status = snapshot(&app);
                    if status.enabled && !status.suspended && status.config.highlight {
                        if let Err(error) = locate_presentation_mouse(app.clone()).await {
                            report_error(&app, error);
                        }
                    }
                });
            } else {
                dispatch_toggle(app);
            }
        })
        .map_err(|e| format!("快捷键 {value} 注册失败，可能已被占用：{e}"))
}

pub(super) fn replace(app: &AppHandle, config: &PresentationConfig) -> Result<(), String> {
    validate(config)?;
    let runtime = app.state::<PresentationRuntime>();
    let mut registered = runtime
        .shortcuts
        .lock()
        .map_err(|_| "演示快捷键状态已损坏")?;
    let desired = vec![
        (config.toggle_shortcut.clone(), false),
        (config.locate_shortcut.clone(), true),
    ];
    if *registered == desired {
        runtime
            .state
            .lock()
            .map_err(|_| "演示状态已损坏")?
            .shortcut_error = None;
        return Ok(());
    }
    let previous = registered.clone();
    // Only unregister bindings owned by presentation, never the global registry.
    for (value, _) in &previous {
        app.global_shortcut()
            .unregister(value.as_str())
            .map_err(|e| format!("注销演示快捷键失败：{e}"))?;
    }
    registered.clear();
    for (value, locate) in &desired {
        if let Err(error) = register(app, value, *locate) {
            let mut errors = vec![error];
            for (current, _) in registered.drain(..) {
                if let Err(e) = app.global_shortcut().unregister(current.as_str()) {
                    errors.push(e.to_string());
                }
            }
            for (old, locate) in &previous {
                match register(app, old, *locate) {
                    Ok(()) => registered.push((old.clone(), *locate)),
                    Err(e) => errors.push(format!("恢复旧快捷键失败：{e}")),
                }
            }
            let error = errors.join("；");
            runtime
                .state
                .lock()
                .map_err(|_| "演示状态已损坏")?
                .shortcut_error = Some(error.clone());
            publish(app);
            return Err(error);
        }
        registered.push((value.clone(), *locate));
    }
    runtime
        .state
        .lock()
        .map_err(|_| "演示状态已损坏")?
        .shortcut_error = None;
    Ok(())
}

pub(super) fn initialize(app: &AppHandle) {
    let config = snapshot(app).config;
    if let Err(error) = replace(app, &config) {
        app.state::<PresentationRuntime>()
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .shortcut_error = Some(error);
    }
    publish(app);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn aliases_cannot_assign_both_actions_to_the_same_shortcut() {
        let config = PresentationConfig {
            toggle_shortcut: "Ctrl+Alt+P".into(),
            locate_shortcut: "Control+Alt+P".into(),
            ..Default::default()
        };
        assert!(validate(&config).is_err());
        assert!(validate(&PresentationConfig::default()).is_ok());
    }
}
