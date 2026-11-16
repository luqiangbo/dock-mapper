use super::*;
use std::sync::atomic::{AtomicU8, Ordering};

// 0: accepting edits; 1: flushing; 2: flush committed, allow the final exit.
struct ExitGate(AtomicU8);
impl ExitGate {
    fn begin(&self) -> bool {
        self.0
            .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }
    fn committed(&self) -> bool {
        self.0.load(Ordering::Acquire) == 2
    }
    fn writable(&self) -> bool {
        self.0.load(Ordering::Acquire) == 0
    }
    fn finish(&self, success: bool) {
        self.0.store(if success { 2 } else { 0 }, Ordering::Release);
    }
}
static EXIT: ExitGate = ExitGate(AtomicU8::new(0));
static CLOSING: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));
pub(super) static OPTION_QUEUE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub(super) fn require_writable(id: Option<&str>) -> Result<(), String> {
    if !EXIT.writable() {
        return Err("正在保存贴图并退出，请稍候".into());
    }
    if id.is_some_and(|id| CLOSING.lock_or_recover().contains(id)) {
        return Err("正在保存并关闭此贴图，请稍候".into());
    }
    Ok(())
}

struct Closing(String);
impl Closing {
    fn begin(id: &str) -> Result<Self, String> {
        require_writable(Some(id))?;
        if !CLOSING.lock_or_recover().insert(id.to_owned()) {
            return Err("正在关闭贴图，请稍候".into());
        }
        Ok(Self(id.to_owned()))
    }
}
impl Drop for Closing {
    fn drop(&mut self) {
        CLOSING.lock_or_recover().remove(&self.0);
    }
}

pub(super) async fn close(app: AppHandle, id: String) -> Result<(), String> {
    let _options = OPTION_QUEUE.lock().await;
    let _closing = Closing::begin(&id)?;
    let window = app.get_webview_window(&id).ok_or("贴图窗口不存在")?;
    window.set_enabled(false).map_err(|e| e.to_string())?;
    let result = pin_archive::save(app.clone(), Some(id.clone())).await;
    if let Err(error) = result {
        if let Err(enable) = window.set_enabled(true) {
            tracing::warn!(%enable, "恢复贴图交互失败");
        }
        return Err(format!("贴图未关闭，保存失败：{error}"));
    }
    if let Err(error) = window.destroy() {
        if let Err(enable) = window.set_enabled(true) {
            tracing::warn!(%enable, "恢复贴图交互失败");
        }
        return Err(format!("已保存贴图，但关闭窗口失败：{error}"));
    }
    app.state::<AppState>()
        .pin_runtime
        .lock_or_recover()
        .remove(&id);
    Ok(())
}

fn enabled(app: &AppHandle, value: bool) {
    let ids = app
        .state::<AppState>()
        .pin_runtime
        .lock_or_recover()
        .order
        .clone();
    for id in ids {
        if let Some(window) = app.get_webview_window(&id) {
            if let Err(error) = window.set_enabled(value) {
                tracing::warn!(%error, "切换贴图交互失败");
            }
        }
    }
}

fn exit_failed(app: &AppHandle, error: String) {
    EXIT.finish(false);
    enabled(app, true);
    let message = format!("贴图状态未保存，暂未退出：{error}");
    tracing::error!(%message);
    if let Err(error) = app.emit("pin-persistence-error", message) {
        tracing::warn!(%error);
    }
    show_main_window(app);
}

/// Returns true when the caller must prevent this exit request.
pub(crate) fn defer_exit(app: &AppHandle, code: Option<i32>) -> bool {
    if EXIT.committed() {
        return false;
    }
    if !EXIT.begin() {
        return true;
    }
    if pin_archive::is_restoring() {
        exit_failed(app, "正在恢复贴图，请稍后重试".into());
        return true;
    }
    enabled(app, false);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Wait for explicit setting saves/close operations already in flight.
        let _options = OPTION_QUEUE.lock().await;
        let result = pin_archive::save(app.clone(), None).await;
        let ui = app.clone();
        if let Err(error) = app.run_on_main_thread(move || match result {
            Ok(()) => {
                EXIT.finish(true);
                ui.exit(code.unwrap_or(0));
            }
            Err(error) => exit_failed(&ui, error),
        }) {
            EXIT.finish(false);
            tracing::error!(%error, "退出保存结果调度失败");
            let _ = app.emit(
                "pin-persistence-error",
                format!("退出调度失败，请重试：{error}"),
            );
        }
    });
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exit_waits_for_commit_and_a_failed_save_allows_edits_and_retry() {
        let gate = ExitGate(AtomicU8::new(0));
        assert!(gate.writable());
        assert!(gate.begin());
        assert!(!gate.begin());
        assert!(!gate.writable());
        assert!(!gate.committed());
        gate.finish(false);
        assert!(gate.writable());
        assert!(gate.begin());
        gate.finish(true);
        assert!(gate.committed());
        assert!(!gate.writable());
    }
}
