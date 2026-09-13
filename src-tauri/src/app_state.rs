use crate::{config, history, image_store, taskbar};
use std::{
    path::PathBuf,
    sync::{atomic::AtomicBool, Arc, Mutex},
};

/// Process-wide state shared by commands that operate on persisted settings,
/// transient images, and screenshot history.
///
/// Capture-window state intentionally lives in the `screenshot` module;
/// keeping the two lifecycles separate avoids the former pair of unrelated
/// `AppState` types.
pub struct AppState {
    pub(crate) config: Mutex<config::AppConfig>,
    pub(crate) images: image_store::ImageStore,
    pub(crate) history: Arc<history::HistoryStore>,
    pub(crate) config_path: PathBuf,
    pub(crate) widget_layout: Mutex<taskbar::WidgetLayoutRequest>,
    pub(crate) mutation_lock: Mutex<()>,
    pub(crate) admin_operation_in_progress: AtomicBool,
}

impl AppState {
    pub(crate) fn new(
        config: config::AppConfig,
        config_path: PathBuf,
        history: Arc<history::HistoryStore>,
    ) -> Self {
        Self {
            config: Mutex::new(config),
            images: image_store::ImageStore::default(),
            history,
            config_path,
            widget_layout: Mutex::new(taskbar::WidgetLayoutRequest::default()),
            mutation_lock: Mutex::new(()),
            admin_operation_in_progress: AtomicBool::new(false),
        }
    }

    pub(crate) fn persist_config(&self) -> Result<(), String> {
        let config = self
            .config
            .lock()
            .map_err(|_| "配置状态已损坏".to_string())?
            .clone();
        config::save(&self.config_path, &config)
    }
}

pub(crate) fn persist(state: &AppState) -> Result<(), String> {
    state.persist_config()
}
