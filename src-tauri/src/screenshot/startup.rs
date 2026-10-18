use super::*;

pub const STARTUP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);
pub const STARTUP_EVENT: &str = "capture-start-state";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStartState {
    pub generation: u64,
    pub phase: CaptureStartPhase,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CaptureStartPhase {
    Starting,
    Shown,
    Failed,
}

#[derive(Default)]
pub struct CaptureStartup {
    current: Option<CaptureStartState>,
}
impl CaptureStartup {
    pub fn begin(&mut self, generation: u64) -> Result<CaptureStartState, String> {
        if self
            .current
            .as_ref()
            .is_some_and(|state| state.phase == CaptureStartPhase::Starting)
        {
            return Err("截图正在启动，请稍候".into());
        }
        let next = CaptureStartState {
            generation,
            phase: CaptureStartPhase::Starting,
            error: None,
        };
        self.current = Some(next.clone());
        Ok(next)
    }
    pub fn pending(&self, generation: u64) -> bool {
        self.current.as_ref().is_some_and(|state| {
            state.generation == generation && state.phase == CaptureStartPhase::Starting
        })
    }
    pub fn generation(&self) -> Option<u64> {
        self.current
            .as_ref()
            .filter(|state| state.phase == CaptureStartPhase::Starting)
            .map(|state| state.generation)
    }
    pub fn finish(&mut self, generation: u64, error: Option<String>) -> Option<CaptureStartState> {
        if !self.pending(generation) {
            return None;
        }
        let next = CaptureStartState {
            generation,
            phase: if error.is_some() {
                CaptureStartPhase::Failed
            } else {
                CaptureStartPhase::Shown
            },
            error,
        };
        self.current = Some(next.clone());
        Some(next)
    }
}

pub(super) fn publish(app: &AppHandle, status: &CaptureStartState) {
    tracing::info!(target: "dock_mapper::capture", generation = status.generation, phase = ?status.phase, "Capture startup state");
    if let Err(error) = app.emit(STARTUP_EVENT, status) {
        tracing::error!(target: "dock_mapper::capture", %error, "截图启动状态通知失败");
    }
}

pub(super) fn request_error(app: &AppHandle, error: String) {
    if let Err(error) = app.emit("capture-request-error", error) {
        tracing::error!(target: "dock_mapper::capture", %error, "无法通知主窗口截图请求失败");
    }
    reveal_main(app);
}

fn reveal_main(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        if let Err(error) = main
            .unminimize()
            .and_then(|_| main.show())
            .and_then(|_| main.set_focus())
        {
            tracing::error!(target: "dock_mapper::capture", %error, "无法显示截图失败反馈窗口");
        }
    }
}

pub(super) fn fail_startup(app: &AppHandle, generation: u64, error: String) -> bool {
    let state = app.state::<AppState>();
    let mut startup = state.startup.lock_or_recover();
    let Some(status) = startup.finish(generation, Some(error)) else {
        return false;
    };
    if let Some(window) = active_overlay_window(app) {
        state.overlay_ready.lock_or_recover().remove(window.label());
        if let Err(error) = window.close() {
            tracing::warn!(target: "dock_mapper::capture", %error, "失败浮层关闭失败");
        }
    }
    *state.capture.lock_or_recover() = None;
    *URI_CAPTURE.lock_or_recover() = None;
    resume_visualizer(app);
    publish(app, &status);
    reveal_main(app);
    tracing::error!(target: "dock_mapper::capture", generation, detail = %crate::diagnostics::redact_sensitive_text(status.error.as_deref().unwrap_or_default()), "截图启动失败");
    true
}

pub(super) fn report_capture_failed(
    app: AppHandle,
    window: tauri::WebviewWindow,
    label: String,
    generation: Option<u64>,
    error: String,
) -> Result<bool, String> {
    if window.label() != label {
        return Err("不能报告其他窗口的截图错误".into());
    }
    let state = app.state::<AppState>();
    if state.active_overlay.lock_or_recover().as_deref() != Some(label.as_str()) {
        return Ok(false);
    }
    let current = state.startup.lock_or_recover().generation();
    let Some(current) = current else {
        return Ok(false);
    };
    if generation.is_some_and(|candidate| candidate != current) {
        return Ok(false);
    }
    let detail: String = error.chars().take(600).collect();
    Ok(fail_startup(
        &app,
        current,
        format!("截图浮层加载失败：{detail}"),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn loading_lasts_until_shown_and_duplicate_clicks_report_busy() {
        let mut flow = CaptureStartup::default();
        assert_eq!(flow.begin(1).unwrap().phase, CaptureStartPhase::Starting);
        assert!(flow.begin(2).unwrap_err().contains("正在启动"));
        assert!(flow.pending(1));
        assert_eq!(
            flow.finish(1, None).unwrap().phase,
            CaptureStartPhase::Shown
        );
        assert!(flow.begin(3).is_ok());
    }
    #[test]
    fn failure_at_each_startup_boundary_allows_retry_and_rejects_old_results() {
        for error in [
            "捕获失败",
            "浮层未就绪",
            "图片解码失败",
            "绘制确认失败",
            "窗口显示失败",
            "截图启动超时",
        ] {
            let mut flow = CaptureStartup::default();
            flow.begin(1).unwrap();
            assert_eq!(
                flow.finish(1, Some(error.into())).unwrap().phase,
                CaptureStartPhase::Failed
            );
            flow.begin(2).unwrap();
            assert!(!flow.pending(1));
            assert!(flow.finish(1, None).is_none());
            assert!(flow.finish(1, Some("迟到的错误".into())).is_none());
            assert!(flow.pending(2));
            assert!(flow.finish(2, None).is_some());
        }
        assert_eq!(STARTUP_TIMEOUT.as_secs(), 8);
    }
}
