use crate::{KeyMapping, WidgetConfig};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

lazy_static::lazy_static! {
    static ref CONFIG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub key_mappings: Vec<KeyMapping>,
    pub widget_config: WidgetConfig,
    pub minimize_to_tray: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            key_mappings: Vec::new(),
            widget_config: WidgetConfig { memory_scheme: 1 },
            minimize_to_tray: true,
        }
    }
}

/// Initialise the config path and load saved config into in-memory stores.
/// Must be called once during app setup.
pub fn init(app_data_dir: PathBuf) -> AppConfig {
    let path = app_data_dir.join("config.json");
    *CONFIG_PATH.lock().unwrap() = Some(path.clone());

    if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str::<AppConfig>(&content) {
                Ok(config) => {
                    println!("[config] Loaded from {}", path.display());
                    return config;
                }
                Err(e) => {
                    eprintln!("[config] Parse error, using defaults: {e}");
                }
            },
            Err(e) => {
                eprintln!("[config] Read error, using defaults: {e}");
            }
        }
    } else {
        println!("[config] No config file found, using defaults");
    }

    AppConfig::default()
}

/// Persist the current config to disk.
pub fn save(config: &AppConfig) {
    let path = CONFIG_PATH.lock().unwrap().clone();
    let Some(path) = path else {
        eprintln!("[config] save called before init");
        return;
    };

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    match serde_json::to_string_pretty(config) {
        Ok(json) => match std::fs::write(&path, &json) {
            Ok(_) => {}
            Err(e) => eprintln!("[config] Failed to write config: {e}"),
        },
        Err(e) => eprintln!("[config] Failed to serialize config: {e}"),
    }
}
