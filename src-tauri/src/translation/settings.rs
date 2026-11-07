use serde::{Deserialize, Deserializer, Serialize};

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    #[default]
    Baidu,
    Deepl,
}

fn deserialize_saved_provider<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Provider, D::Error> {
    // Retired providers only migrate in persisted configuration. New command
    // drafts use the strict two-provider enum and cannot silently pick another.
    Ok(if String::deserialize(deserializer)? == "deepl" {
        Provider::Deepl
    } else {
        Provider::Baidu
    })
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Auto,
    #[default]
    Zh,
    En,
    Ja,
    Ko,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TranslationConfig {
    #[serde(deserialize_with = "deserialize_saved_provider")]
    pub provider: Provider,
    pub source: Language,
    pub target: Language,
    pub deepl_free: bool,
    pub baidu_app_id: String,
    pub baidu_verified: bool,
    pub deepl_verified: bool,
    pub baidu_key: Option<String>,
    pub deepl_key: Option<String>,
    #[serde(rename = "deeplKeyEncrypted", skip_serializing_if = "Option::is_none")]
    pub legacy_deepl_key_encrypted: Option<String>,
    #[serde(skip)]
    pub credential_error: Option<String>,
}

impl std::fmt::Debug for TranslationConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TranslationConfig")
            .field("provider", &self.provider)
            .field("source", &self.source)
            .field("target", &self.target)
            .field("baidu_key_configured", &self.baidu_key.is_some())
            .field("deepl_key_configured", &self.deepl_key.is_some())
            .finish_non_exhaustive()
    }
}

impl Default for TranslationConfig {
    fn default() -> Self {
        Self {
            provider: Provider::Baidu,
            source: Language::Auto,
            target: Language::Zh,
            deepl_free: true,
            baidu_app_id: String::new(),
            baidu_verified: false,
            deepl_verified: false,
            baidu_key: None,
            deepl_key: None,
            legacy_deepl_key_encrypted: None,
            credential_error: None,
        }
    }
}

impl TranslationConfig {
    pub(crate) fn migrate_legacy_key(&mut self) {
        if self.deepl_key.is_some() {
            self.legacy_deepl_key_encrypted = None;
            self.credential_error = None;
            return;
        }
        let Some(encrypted) = &self.legacy_deepl_key_encrypted else {
            return;
        };
        match super::secret::decrypt(encrypted) {
            Ok(key) => {
                self.deepl_key = Some(key);
                self.legacy_deepl_key_encrypted = None;
                self.credential_error = None;
            }
            Err(_) => {
                self.credential_error =
                    Some("旧 DeepL Key 无法读取，请重新填写。其他设置已保留。".into())
            }
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub provider: Provider,
    pub source: Language,
    pub target: Language,
    pub deepl_free: bool,
    pub baidu_app_id: String,
    pub baidu_verified: bool,
    pub deepl_verified: bool,
    pub baidu_key_configured: bool,
    pub deepl_key_configured: bool,
    pub credential_error: Option<String>,
}
impl From<&TranslationConfig> for SettingsView {
    fn from(config: &TranslationConfig) -> Self {
        Self {
            provider: config.provider,
            source: config.source,
            target: config.target,
            deepl_free: config.deepl_free,
            baidu_app_id: config.baidu_app_id.clone(),
            baidu_verified: config.baidu_verified,
            deepl_verified: config.deepl_verified,
            baidu_key_configured: config.baidu_key.is_some(),
            deepl_key_configured: config.deepl_key.is_some(),
            credential_error: config.credential_error.clone(),
        }
    }
}

// None preserves the stored key; an empty string explicitly clears it.
// No Debug implementation: drafts contain user credentials.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDraft {
    pub provider: Provider,
    pub source: Language,
    pub target: Language,
    pub deepl_free: bool,
    pub baidu_app_id: String,
    pub baidu_key: Option<String>,
    pub deepl_key: Option<String>,
}

fn update_key(current: &Option<String>, value: &Option<String>) -> Result<Option<String>, String> {
    match value {
        None => Ok(current.clone()),
        Some(value) if value.trim().is_empty() => Ok(None),
        Some(value) => {
            let value = value.trim();
            if value.len() > 4096 || value.chars().any(char::is_control) {
                return Err("API Key 格式无效".into());
            }
            Ok(Some(value.into()))
        }
    }
}

pub fn apply(
    current: &TranslationConfig,
    draft: SettingsDraft,
) -> Result<TranslationConfig, String> {
    validate_pair(draft.provider, draft.source, draft.target)?;
    let app_id = draft.baidu_app_id.trim();
    if draft.provider == Provider::Baidu
        && (app_id.len() > 64 || !app_id.chars().all(|c| c.is_ascii_digit()))
    {
        return Err("百度 App ID 应为数字，请从开放平台复制".into());
    }
    let mut next = current.clone();
    next.migrate_legacy_key();
    next.provider = draft.provider;
    next.source = draft.source;
    next.target = draft.target;
    next.deepl_free = draft.deepl_free;
    next.baidu_app_id = app_id.into();
    next.baidu_key = update_key(&next.baidu_key, &draft.baidu_key)?;
    next.deepl_key = update_key(&next.deepl_key, &draft.deepl_key)?;
    if draft.deepl_key.is_some() {
        next.legacy_deepl_key_encrypted = None;
        next.credential_error = None;
    }
    next.baidu_verified = (current.baidu_verified
        && current.baidu_app_id == next.baidu_app_id
        && current.baidu_key == next.baidu_key)
        || tested(&next, Provider::Baidu);
    next.deepl_verified = (current.deepl_verified
        && current.deepl_free == next.deepl_free
        && current.deepl_key == next.deepl_key)
        || tested(&next, Provider::Deepl);
    Ok(next)
}

impl Provider {
    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Baidu => "百度翻译",
            Self::Deepl => "DeepL",
        }
    }
}
pub(super) fn validate_pair(
    _provider: Provider,
    _source: Language,
    target: Language,
) -> Result<(), String> {
    if target == Language::Auto {
        return Err("请选择目标语言".into());
    }
    Ok(())
}

// Only fingerprints of successful requests are retained; no text or credentials are cached.
static TESTED: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
fn fingerprint(config: &TranslationConfig, provider: Provider) -> String {
    let values = match provider {
        Provider::Baidu => serde_json::json!(["baidu", config.baidu_app_id, config.baidu_key]),
        Provider::Deepl => serde_json::json!(["deepl", config.deepl_free, config.deepl_key]),
    };
    format!("{:x}", md5::compute(values.to_string().as_bytes()))
}
fn tested(config: &TranslationConfig, provider: Provider) -> bool {
    TESTED
        .lock()
        .map(|values| values.contains(&fingerprint(config, provider)))
        .unwrap_or(false)
}
pub(super) fn remember_test(config: &TranslationConfig) {
    if let Ok(mut values) = TESTED.lock() {
        let value = fingerprint(config, config.provider);
        if !values.contains(&value) {
            if values.len() >= 256 {
                values.remove(0);
            }
            values.push(value);
        }
    }
}
pub(super) fn verified(config: &TranslationConfig, provider: Provider) -> bool {
    match provider {
        Provider::Baidu => config.baidu_verified,
        Provider::Deepl => config.deepl_verified,
    }
}
