mod blocks;
mod providers;
mod secret;
pub mod settings;
#[cfg(test)]
mod tests;

use crate::AppState;
use serde::{Deserialize, Serialize};
use settings::{Language, Provider, SettingsDraft, SettingsView, TranslationConfig};
use tauri::Emitter;
use tauri::State;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationRequest {
    pub text: String,
    pub provider: Provider,
    pub source: Language,
    pub target: Language,
}

fn snapshot(state: &AppState) -> Result<TranslationConfig, String> {
    Ok(state
        .config
        .lock()
        .map_err(|_| "配置状态已损坏")?
        .translation_config
        .clone())
}

#[tauri::command]
pub fn get_translation_settings(state: State<'_, AppState>) -> Result<SettingsView, String> {
    Ok(SettingsView::from(&snapshot(&state)?))
}

pub(crate) fn save_settings(
    state: &AppState,
    draft: SettingsDraft,
) -> Result<SettingsView, String> {
    let _mutation = state.mutation_lock.lock().map_err(|_| "配置写入锁已损坏")?;
    let mut next = state.config.lock().map_err(|_| "配置状态已损坏")?.clone();
    let previous_provider = next.translation_config.provider;
    next.translation_config = settings::apply(&next.translation_config, draft)?;
    if !settings::verified(&next.translation_config, next.translation_config.provider) {
        next.translation_config.provider = previous_provider;
    }
    crate::config::save(&state.config_path, &next)?;
    let result = SettingsView::from(&next.translation_config);
    *state.config.lock().map_err(|_| "配置状态已损坏")? = next;
    Ok(result)
}

#[tauri::command]
pub fn update_translation_settings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    draft: SettingsDraft,
) -> Result<SettingsView, String> {
    let result = save_settings(&state, draft)?;
    app.emit("translation-settings-changed", &result)
        .map_err(|_| "翻译设置已保存，但截图同步失败，请重新截图或重试保存")?;
    Ok(result)
}

#[tauri::command]
pub async fn translate_text(
    state: State<'_, AppState>,
    request: TranslationRequest,
) -> Result<String, String> {
    let config = snapshot(&state)?;
    if !settings::verified(&config, request.provider) {
        return Err("请先在翻译设置中测试并保存此服务".into());
    }
    providers::translate(&config, request).await
}

#[tauri::command]
pub async fn test_translation_service(
    state: State<'_, AppState>,
    draft: SettingsDraft,
    text: String,
) -> Result<String, String> {
    let config = settings::apply(&snapshot(&state)?, draft)?;
    let request = trial_request(&config, text)?;
    let result = providers::translate(&config, request).await?;
    if result.trim().is_empty() {
        return Err("翻译服务返回了空译文".into());
    }
    settings::remember_test(&config);
    Ok(result)
}

fn trial_request(config: &TranslationConfig, text: String) -> Result<TranslationRequest, String> {
    if text.trim().is_empty() {
        return Err("请输入需要测试的文字".into());
    }
    if text.chars().count() > 5000 {
        return Err("测试文本超过 5,000 字符，请缩短后重试".into());
    }
    settings::validate_pair(config.provider, config.source, config.target)?;
    Ok(TranslationRequest {
        text,
        provider: config.provider,
        source: config.source,
        target: config.target,
    })
}

#[derive(Clone, Deserialize, Serialize)]
pub struct TranslationBlock {
    pub id: u32,
    pub text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockTranslationRequest {
    pub blocks: Vec<TranslationBlock>,
    pub provider: Provider,
    pub source: Language,
    pub target: Language,
}

#[tauri::command]
pub async fn translate_ocr_blocks(
    state: State<'_, AppState>,
    request: BlockTranslationRequest,
) -> Result<Vec<TranslationBlock>, String> {
    let config = snapshot(&state)?;
    if !settings::verified(&config, request.provider) {
        return Err("请先在翻译设置中测试并保存此服务".into());
    }
    blocks::translate_many(&config, request).await
}
