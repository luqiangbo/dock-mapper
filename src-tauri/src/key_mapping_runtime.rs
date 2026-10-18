mod engine;
mod native;
pub(crate) use engine::{rules, Rules};
use std::sync::{
    atomic::{AtomicU8, AtomicUsize, Ordering},
    Arc, Mutex,
};
use tauri::AppHandle;

#[derive(Default)]
pub struct Runtime {
    worker: Mutex<Option<native::Worker>>,
    health: Arc<AtomicU8>,
    last_error: Mutex<Option<String>>,
    count: AtomicUsize,
}
impl Runtime {
    pub fn configure(&self, app: &AppHandle, rules: Rules) -> Result<(), String> {
        let count = rules.len();
        let result = self.apply(app, rules);
        if result.is_ok() {
            self.count.store(count, Ordering::Release);
        }
        if let Ok(mut error) = self.last_error.lock() {
            *error = result.as_ref().err().cloned();
        }
        result
    }
    fn apply(&self, app: &AppHandle, rules: Rules) -> Result<(), String> {
        let mut worker = self.worker.lock().map_err(|_| "映射运行锁已损坏")?;
        if worker.as_ref().is_some_and(|worker| !worker.alive()) {
            worker.take();
        }
        if worker.is_none() && rules.is_empty() {
            return Ok(());
        }
        if worker.is_none() {
            *worker = Some(native::Worker::start(app.clone(), self.health.clone())?);
        }
        worker.as_ref().unwrap().configure(rules)
    }
    pub fn error(&self) -> Option<String> {
        if self
            .worker
            .lock()
            .map(|worker| worker.as_ref().is_some_and(|worker| !worker.alive()))
            .unwrap_or(true)
        {
            return Some("按键映射线程已停止，请重试运行".into());
        }
        if let Ok(error) = self.last_error.lock() {
            if error.is_some() {
                return error.clone();
            }
        }
        match self.health.load(Ordering::Acquire) {
            0 => None,
            _ => Some("按键映射已暂停：无法注入或释放按键，请切回普通权限窗口后重试。管理员窗口不受支持。".into()),
        }
    }
    pub fn count(&self) -> usize {
        self.count.load(Ordering::Acquire)
    }
    pub fn report(&self, message: String) {
        if let Ok(mut error) = self.last_error.lock() {
            *error = Some(message);
        }
    }
    pub fn stop(&self) {
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(worker) = worker.take() {
                drop(worker);
            }
        }
    }
}
