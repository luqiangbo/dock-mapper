use crate::AppState;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use tauri::{
    window::{Effect, EffectsBuilder},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder,
};

const LABEL: &str = "history_preview";
pub const SESSION_EVENT: &str = "history-preview-session";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSession {
    pub id: String,
    pub generation: u64,
    pub ids: Vec<String>,
}

#[derive(Default)]
pub struct PreviewState {
    inner: Mutex<PreviewRuntime>,
    opening: tokio::sync::Mutex<()>,
    requested: AtomicU64,
}

#[derive(Default)]
struct PreviewRuntime {
    generation: u64,
    session: Option<PreviewSession>,
}

impl PreviewRuntime {
    fn select_if_current(&mut self, expected: u64, id: String) -> Result<PreviewSession, String> {
        let current = self
            .session
            .as_ref()
            .filter(|session| session.generation == expected)
            .ok_or("预览已切换，请重试")?;
        if !current.ids.contains(&id) {
            return Err("截图不在当前预览列表中".into());
        }
        let ids = current.ids.clone();
        Ok(self.select(id, ids))
    }
    fn select(&mut self, id: String, ids: Vec<String>) -> PreviewSession {
        let mut unique = std::collections::HashSet::new();
        let mut ids = ids
            .into_iter()
            .filter(|item| unique.insert(item.clone()))
            .collect::<Vec<_>>();
        if !ids.contains(&id) {
            ids = vec![id.clone()];
        }
        self.generation += 1;
        let session = PreviewSession {
            id,
            generation: self.generation,
            ids,
        };
        self.session = Some(session.clone());
        session
    }
}

#[tauri::command]
pub async fn open_screenshot_history_preview(
    app: AppHandle,
    state: State<'_, AppState>,
    preview: State<'_, PreviewState>,
    id: String,
    ids: Option<Vec<String>>,
) -> Result<(), String> {
    let request = preview.requested.fetch_add(1, Ordering::SeqCst) + 1;
    let history = state.history.clone();
    let validated_id = id.clone();
    tokio::task::spawn_blocking(move || history.summary(&validated_id))
        .await
        .map_err(|error| format!("读取截图信息失败：{error}"))??;
    let _opening = preview.opening.lock().await;
    if request != preview.requested.load(Ordering::SeqCst) {
        return Ok(());
    }
    let (previous, session) = {
        let mut runtime = preview.inner.lock().map_err(|_| "原图预览状态不可用")?;
        (
            runtime.session.clone(),
            runtime.select(id, ids.unwrap_or_default()),
        )
    };
    let result = (|| {
        let window = if let Some(window) = app.get_webview_window(LABEL) {
            window
        } else {
            let monitor = app
                .get_webview_window("main")
                .and_then(|window| window.current_monitor().ok().flatten())
                .or_else(|| app.primary_monitor().ok().flatten());
            let (width, height) = monitor
                .as_ref()
                .map(|monitor| {
                    preview_dimensions(
                        monitor.work_area().size.width as f64 / monitor.scale_factor(),
                        monitor.work_area().size.height as f64 / monitor.scale_factor(),
                    )
                })
                .unwrap_or((960.0, 720.0));
            let window = WebviewWindowBuilder::new(
                &app,
                LABEL,
                WebviewUrl::App("history-preview.html".into()),
            )
            .title("DockMapper — 截图原图")
            .inner_size(width, height)
            .min_inner_size(320.0, 240.0)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .resizable(true)
            .visible(false)
            .build()
            .map_err(|error| error.to_string())?;
            if let Some(monitor) = monitor {
                let area = monitor.work_area();
                let physical_width = (width * monitor.scale_factor()).round() as u32;
                let physical_height = (height * monitor.scale_factor()).round() as u32;
                window
                    .set_position(tauri::PhysicalPosition::new(
                        area.position.x
                            + (area.size.width.saturating_sub(physical_width) / 2) as i32,
                        area.position.y
                            + (area.size.height.saturating_sub(physical_height) / 2) as i32,
                    ))
                    .map_err(|error| error.to_string())?;
                window
                    .set_size(tauri::PhysicalSize::new(physical_width, physical_height))
                    .map_err(|error| error.to_string())?;
            }
            if let Err(error) =
                window.set_effects(EffectsBuilder::new().effect(Effect::Acrylic).build())
            {
                tracing::warn!(target: "dock_mapper::history_preview", %error, "原图预览磨砂材质启用失败，使用半透明底色");
            }
            window
        };
        window
            .emit(SESSION_EVENT, &session)
            .map_err(|error| error.to_string())?;
        window.unminimize().map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        preview
            .inner
            .lock()
            .map_err(|_| "原图预览状态不可用")?
            .session = previous;
    }
    result
}

#[tauri::command]
pub fn get_screenshot_history_preview_session(
    preview: State<'_, PreviewState>,
) -> Result<Option<PreviewSession>, String> {
    Ok(preview
        .inner
        .lock()
        .map_err(|_| "原图预览状态不可用")?
        .session
        .clone())
}

fn adjacent_id(session: &PreviewSession, direction: i8) -> Result<String, String> {
    if direction != -1 && direction != 1 {
        return Err("切换方向无效".into());
    }
    let index = session
        .ids
        .iter()
        .position(|id| id == &session.id)
        .ok_or("当前截图不在预览列表中")? as isize;
    session
        .ids
        .get((index + direction as isize) as usize)
        .cloned()
        .ok_or_else(|| "已到预览列表首尾".into())
}

#[tauri::command]
pub async fn navigate_screenshot_history_preview(
    app: AppHandle,
    state: State<'_, AppState>,
    preview: State<'_, PreviewState>,
    generation: u64,
    direction: i8,
) -> Result<PreviewSession, String> {
    let request = preview.requested.load(Ordering::SeqCst);
    let current = preview
        .inner
        .lock()
        .map_err(|_| "原图预览状态不可用")?
        .session
        .clone()
        .ok_or("没有可预览的截图")?;
    if current.generation != generation {
        return Err("预览已切换，请重试".into());
    }
    let id = adjacent_id(&current, direction)?;
    let history = state.history.clone();
    let validated = id.clone();
    tokio::task::spawn_blocking(move || history.summary(&validated))
        .await
        .map_err(|error| format!("读取截图信息失败：{error}"))??;
    let _opening = preview.opening.lock().await;
    let mut runtime = preview.inner.lock().map_err(|_| "原图预览状态不可用")?;
    if request != preview.requested.load(Ordering::SeqCst)
        || runtime.session.as_ref().map(|s| s.generation) != Some(generation)
    {
        return Err("预览已切换，请重试".into());
    }
    let window = app.get_webview_window(LABEL).ok_or("预览窗口已关闭")?;
    let next = runtime.select_if_current(generation, id)?;
    if let Err(error) = window.emit(SESSION_EVENT, &next) {
        runtime.session = Some(current);
        return Err(error.to_string());
    }
    Ok(next)
}

fn preview_dimensions(work_width: f64, work_height: f64) -> (f64, f64) {
    (
        960.0_f64.min((work_width - 32.0).max(320.0)),
        720.0_f64.min((work_height - 32.0).max(240.0)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opening_another_image_advances_the_session_even_for_the_same_id() {
        let mut state = PreviewRuntime::default();
        assert!(state.session.is_none());
        let first = state.select("history-1-1".into(), vec![]);
        let next = state.select(first.id.clone(), vec![]);
        assert!(next.generation > first.generation);
        assert_eq!(state.session.unwrap().generation, next.generation);
    }
    #[test]
    fn preview_navigation_keeps_filtered_order_and_stops_at_ends() {
        let mut state = PreviewRuntime::default();
        let session = state.select(
            "b".into(),
            vec!["c".into(), "b".into(), "a".into(), "b".into()],
        );
        assert_eq!(session.ids, vec!["c", "b", "a"]);
        assert_eq!(adjacent_id(&session, -1).unwrap(), "c");
        assert_eq!(adjacent_id(&session, 1).unwrap(), "a");
        let first = state.select("c".into(), session.ids);
        assert!(adjacent_id(&first, -1).is_err());
        assert!(adjacent_id(&first, 2).is_err());
        let missing = state.select("other".into(), vec!["c".into()]);
        assert_eq!(missing.ids, vec!["other"]);
        assert!(adjacent_id(&missing, 1).is_err());
    }
    #[test]
    fn an_old_navigation_cannot_replace_a_newly_opened_image() {
        let mut state = PreviewRuntime::default();
        let old = state.select("a".into(), vec!["a".into(), "b".into()]);
        let latest = state.select("c".into(), vec!["c".into(), "d".into()]);
        assert!(state.select_if_current(old.generation, "b".into()).is_err());
        assert_eq!(state.session.as_ref().unwrap().id, "c");
        assert!(state
            .select_if_current(latest.generation, "unlisted".into())
            .is_err());
        let next = state
            .select_if_current(latest.generation, "d".into())
            .unwrap();
        assert_eq!(next.id, "d");
        assert!(next.generation > latest.generation);
    }
    #[test]
    fn preview_fits_small_and_high_dpi_work_areas() {
        assert_eq!(preview_dimensions(1120.0, 680.0), (960.0, 648.0));
        assert_eq!(preview_dimensions(640.0, 600.0), (608.0, 568.0));
        assert_eq!(preview_dimensions(1920.0, 1080.0), (960.0, 720.0));
    }
}
