use super::{
    settings::{Language, Provider, TranslationConfig},
    TranslationRequest,
};
use reqwest::{Client, RequestBuilder, Response};
use serde_json::Value;
use std::{sync::OnceLock, time::Duration};
static CLIENT: OnceLock<Client> = OnceLock::new();

pub(super) fn client() -> Result<Client, String> {
    if let Some(client) = CLIENT.get() {
        return Ok(client.clone());
    }
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        return Err("无法初始化翻译 TLS 服务".into());
    }
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化翻译网络服务")?;
    let _ = CLIENT.set(client.clone());
    Ok(client)
}

pub(super) fn language_code(provider: Provider, language: Language, target: bool) -> &'static str {
    match (provider, language, target) {
        (_, Language::Auto, _) => "auto",
        (Provider::Baidu, Language::Zh, _) => "zh",
        (Provider::Baidu, Language::En, _) => "en",
        (Provider::Baidu, Language::Ja, _) => "jp",
        (Provider::Baidu, Language::Ko, _) => "kor",
        (Provider::Deepl, Language::Zh, true) => "ZH-HANS",
        (Provider::Deepl, Language::Zh, false) => "ZH",
        (Provider::Deepl, Language::En, true) => "EN-US",
        (Provider::Deepl, Language::En, false) => "EN",
        (Provider::Deepl, Language::Ja, _) => "JA",
        (Provider::Deepl, Language::Ko, _) => "KO",
    }
}

#[derive(Debug)]
pub(super) struct TextPart {
    pub text: String,
    pub separator: String,
}

pub(super) fn split_text(text: &str, provider: Provider) -> Result<Vec<TextPart>, String> {
    if text.trim().is_empty() {
        return Err("未发现可翻译的文字".into());
    }
    if text.chars().count() > 5000 {
        return Err("文字超过 5,000 字符，请缩小选区".into());
    }
    let mut parts = Vec::new();
    let max = if provider == Provider::Baidu {
        450
    } else {
        500
    };
    // Baidu defines a query line as a translation unit. Keep every newline in
    // the owner metadata and never recover IDs by splitting translated text.
    for paragraph in text.split_inclusive('\n') {
        let mut remaining = paragraph;
        while !remaining.is_empty() {
            let limit = remaining
                .char_indices()
                .nth(max)
                .map_or(remaining.len(), |(index, _)| index);
            let part = &remaining[..limit];
            let content = part.trim_end_matches(char::is_whitespace);
            parts.push(TextPart {
                text: content.into(),
                separator: part[content.len()..].into(),
            });
            remaining = &remaining[limit..];
        }
    }
    Ok(parts)
}

pub(super) fn status_error(status: u16, _provider: Provider, _value: &Value) -> String {
    match status {
        401 | 403 => "凭据无效或权限不足，请检查 App ID、Key 和已开通的翻译服务".into(),
        429 => "请求频率超过服务限制或额度不足，请稍后重试".into(),
        456 => "翻译额度已耗尽，请检查服务账户".into(),
        400 => "请求未被接受，请检查语言和服务设置".into(),
        _ => "服务暂不可用，请稍后重试".into(),
    }
}
fn network_error(error: reqwest::Error) -> String {
    // Do not expose URLs or response bodies: they can contain source text.
    if error.is_timeout() {
        "翻译超时，请重试".into()
    } else {
        "无法连接翻译服务，请检查网络后重试".into()
    }
}
pub(super) async fn send(request: RequestBuilder, provider: Provider) -> Result<Value, String> {
    let mut response: Response = request.send().await.map_err(network_error)?;
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if bytes.len() + chunk.len() > 1024 * 1024 {
            return Err("翻译响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value = serde_json::from_slice(&bytes);
    if !status.is_success() {
        return Err(format!(
            "HTTP {}：{}",
            status.as_u16(),
            status_error(status.as_u16(), provider, &value.unwrap_or(Value::Null))
        ));
    }
    value.map_err(|_| "翻译服务返回了无法识别的数据".into())
}

pub(super) async fn translate(
    config: &TranslationConfig,
    request: TranslationRequest,
) -> Result<String, String> {
    let result = super::blocks::translate_many(
        config,
        super::BlockTranslationRequest {
            blocks: vec![super::TranslationBlock {
                id: 0,
                text: request.text,
            }],
            provider: request.provider,
            source: request.source,
            target: request.target,
        },
    )
    .await?;
    result
        .into_iter()
        .next()
        .map(|block| block.text)
        .ok_or_else(|| "未发现可翻译的文字".into())
}
