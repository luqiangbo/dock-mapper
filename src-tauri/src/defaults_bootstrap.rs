use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tokio::sync::watch;

#[derive(Clone)]
enum SetupStatus {
    Pending,
    Ready,
    Failed(String),
}

struct SetupLatch {
    status: watch::Sender<SetupStatus>,
}
impl Default for SetupLatch {
    fn default() -> Self {
        let (status, _) = watch::channel(SetupStatus::Pending);
        Self { status }
    }
}
impl SetupLatch {
    fn finish(&self, result: Result<(), String>) {
        // Keep the result even if setup finishes before the first IPC listener.
        self.status.send_replace(match result {
            Ok(()) => SetupStatus::Ready,
            Err(error) => SetupStatus::Failed(error),
        });
    }
    async fn wait(&self, timeout: std::time::Duration) -> Result<(), String> {
        let mut status = self.status.subscribe();
        tokio::time::timeout(timeout, async {
            loop {
                let current = status.borrow().clone();
                match current {
                    SetupStatus::Ready => return Ok(()),
                    SetupStatus::Failed(error) => {
                        return Err(format!("原生应用状态初始化失败：{error}"))
                    }
                    SetupStatus::Pending => status
                        .changed()
                        .await
                        .map_err(|_| "原生初始化状态监听已关闭".to_string())?,
                }
            }
        })
        .await
        .map_err(|_| "等待原生应用状态初始化超时，请重试".to_string())?
    }
}

#[derive(Default)]
pub struct BootstrapState {
    setup: SetupLatch,
    state: Mutex<Progress>,
    ready: AtomicBool,
}
impl BootstrapState {
    pub fn finish_setup(&self, result: Result<(), String>) {
        self.setup.finish(result);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn early_handshake_waits_until_native_states_have_been_registered() {
        let setup = std::sync::Arc::new(SetupLatch::default());
        let pending = setup.clone();
        let request =
            tokio::spawn(async move { pending.wait(std::time::Duration::from_secs(1)).await });
        tokio::task::yield_now().await;
        assert!(
            !request.is_finished(),
            "提前到达的握手不能读取未注册的 AppState"
        );
        setup.finish(Ok(()));
        assert!(request.await.unwrap().is_ok());
    }

    #[tokio::test]
    async fn completed_setup_is_remembered_for_late_and_repeated_handshakes() {
        let setup = SetupLatch::default();
        setup.finish(Ok(()));
        let (first, second) = tokio::join!(
            setup.wait(std::time::Duration::from_secs(1)),
            setup.wait(std::time::Duration::from_secs(1)),
        );
        assert!(first.is_ok());
        assert!(second.is_ok());
    }

    #[tokio::test]
    async fn native_setup_failure_reports_its_reason_without_poisoning_initialization() {
        let bootstrap = BootstrapState::default();
        bootstrap.finish_setup(Err("配置目录不可写".into()));
        for _ in 0..2 {
            let error = bootstrap
                .setup
                .wait(std::time::Duration::from_secs(1))
                .await
                .unwrap_err();
            assert!(error.contains("配置目录不可写"));
        }
        assert!(bootstrap.state.lock().is_ok());
    }

    #[tokio::test]
    async fn waiting_timeout_can_be_retried_after_setup_finishes() {
        let setup = SetupLatch::default();
        assert!(setup
            .wait(std::time::Duration::from_millis(1))
            .await
            .unwrap_err()
            .contains("超时"));
        setup.finish(Ok(()));
        assert!(setup.wait(std::time::Duration::from_secs(1)).await.is_ok());
    }
}
#[derive(Default)]
struct Progress {
    identity: Option<String>,
    active: Option<String>,
    screenshot: bool,
    widget: bool,
    keys: bool,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapResult {
    reset: bool,
    identity: String,
    restart_required: bool,
}

#[tauri::command]
pub fn application_ready(state: State<BootstrapState>) -> bool {
    state.ready.load(Ordering::Acquire)
}

#[tauri::command]
pub async fn initialize_defaults(
    app: AppHandle,
    window: WebviewWindow,
    build_id: String,
    activate: bool,
) -> Result<BootstrapResult, String> {
    if window.label() != "main" {
        return Err("仅主窗口可初始化应用设置".into());
    }
    {
        let bootstrap = app
            .try_state::<BootstrapState>()
            .ok_or("应用启动状态尚未注册，请重试")?;
        // WebViews can invoke IPC while Tauri is still running its setup hook.
        // Wait asynchronously, without holding the initialization mutex or UI thread.
        bootstrap
            .setup
            .wait(std::time::Duration::from_secs(15))
            .await?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        initialize_defaults_impl(app, window, build_id, activate)
    })
    .await
    .map_err(|error| format!("初始化任务失败：{error}"))?
}

fn initialize_defaults_impl(
    app: AppHandle,
    window: WebviewWindow,
    build_id: String,
    activate: bool,
) -> Result<BootstrapResult, String> {
    if window.label() != "main" {
        return Err("仅主窗口可初始化应用设置".into());
    }
    if build_id.len() != 36
        || !build_id
            .bytes()
            .all(|value| value.is_ascii_hexdigit() || value == b'-')
    {
        return Err("构建标识无效".into());
    }
    let bootstrap = app
        .try_state::<BootstrapState>()
        .ok_or("应用启动状态尚未注册，请重试")?;
    let state = app
        .try_state::<crate::AppState>()
        .ok_or("应用配置状态尚未注册，请重试")?;
    let mut progress = bootstrap.state.lock().map_err(|_| "初始化状态已损坏")?;
    // A running dev process may reconnect to a newly started frontend server.
    // Restart before writing defaults so old renderer saves cannot race reset.
    if progress
        .active
        .as_ref()
        .is_some_and(|active| active != &build_id)
    {
        let installation = state
            .config
            .lock()
            .map_err(|_| "配置状态已损坏")?
            .installation_id
            .clone()
            .unwrap_or_default();
        return Ok(BootstrapResult {
            reset: false,
            identity: format!("{build_id}:{installation}"),
            restart_required: true,
        });
    }
    let _mutation = state
        .mutation_lock
        .lock()
        .map_err(|_| "配置事务状态已损坏")?;
    let mut reset = false;
    if progress.identity.as_deref() != Some(&build_id) {
        let previous = crate::config::load(&state.config_path);
        if previous.defaults_build_id.as_deref() != Some(&build_id) {
            crate::autostart_reset::ensure_disabled(&app)?;
        }
        let (next, did_reset) = crate::config::load_for_build(&state.config_path, &build_id)?;
        reset = did_reset;
        *state.config.lock().map_err(|_| "配置状态已损坏")? = next;
        progress.identity = Some(build_id.clone());
    }
    let restart_required = progress
        .active
        .as_ref()
        .is_some_and(|active| active != &build_id);
    drop(_mutation);
    if activate && !restart_required && progress.active.is_none() {
        if !progress.screenshot {
            crate::screenshot::initialize(&app)?;
            progress.screenshot = true;
        }
        if !progress.widget {
            crate::widget::setup_window(&app)?;
            progress.widget = true;
        }
        if !progress.keys {
            crate::key_visualizer::setup_window(&app)?;
            progress.keys = true;
        }
        let interval = state
            .config
            .lock()
            .map_err(|_| "配置状态已损坏")?
            .widget_config
            .refresh_interval_secs;
        app.try_state::<crate::sys_monitor::SysMonitorControl>()
            .ok_or("系统采集状态尚未注册，请重试")?
            .set_interval(interval);
        crate::visualizer_effects::initialize(&app);
        crate::sys_monitor::start_sys_monitor(app.clone());
        crate::key_mapping::initialize(&app);
        progress.active = Some(build_id.clone());
        bootstrap.ready.store(true, Ordering::Release);
    }
    if activate && !restart_required {
        app.emit("defaults-ready", ())
            .map_err(|error| format!("发布应用就绪失败：{error}"))?;
    }
    let installation = state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏")?
        .installation_id
        .clone()
        .unwrap_or_default();
    Ok(BootstrapResult {
        reset,
        identity: format!("{build_id}:{installation}"),
        restart_required,
    })
}
