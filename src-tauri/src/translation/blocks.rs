use super::{providers::*, settings::*, BlockTranslationRequest, TranslationBlock};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
    time::Duration,
};

pub(super) fn baidu_sign(app_id: &str, text: &str, salt: &str, key: &str) -> String {
    let mut context = md5::Context::new();
    for part in [app_id, text, salt, key] {
        context.consume(part.as_bytes());
    }
    format!("{:x}", context.finalize())
}

pub(super) fn baidu_error(code: &str) -> String {
    match code {
        "52001" => "请求超时，请重试",
        "52002" => "服务繁忙，请稍后重试",
        "52003" | "54001" => "App ID 或密钥无效，请检查凭据及通用文本翻译服务是否开通",
        "54003" => "请求频率超过账户限制，请稍后重试",
        "54004" | "54005" => "余额或翻译额度不足，请检查百度翻译账户",
        "58000" => "调用 IP 不在账户授权范围内，请检查 IP 设置",
        "58001" => "当前语言方向不受支持，请修改源语言或目标语言",
        _ => "请求被拒绝，请检查翻译设置或稍后重试",
    }
    .into()
}

pub(super) fn parse_batch(
    provider: Provider,
    value: &Value,
    texts: &[String],
) -> Result<Vec<String>, String> {
    if provider == Provider::Baidu {
        if let Some(code) = value.get("error_code") {
            let code = code
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| code.as_u64().unwrap_or_default().to_string());
            return Err(baidu_error(&code));
        }
        let values = value
            .get("trans_result")
            .and_then(Value::as_array)
            .ok_or("百度未返回译文，请检查服务开通状态")?;
        if values.len() != texts.len() {
            return Err("百度返回的文字段落数量不匹配，请重试".into());
        }
        return values
            .iter()
            .zip(texts)
            .map(|(value, source)| {
                if value
                    .get("src")
                    .and_then(Value::as_str)
                    .is_none_or(|text| text.trim() != source.trim())
                {
                    return Err("百度返回的原文与文字块不匹配，请重试".into());
                }
                value
                    .get("dst")
                    .and_then(Value::as_str)
                    .filter(|text| !text.trim().is_empty())
                    .map(str::to_owned)
                    .ok_or_else(|| "百度返回了空译文".into())
            })
            .collect();
    }
    let values = value
        .get("translations")
        .and_then(Value::as_array)
        .ok_or("DeepL 未返回译文，请检查套餐和 Key")?;
    if values.len() != texts.len() {
        return Err("DeepL 返回的文字块数量不匹配，请重试".into());
    }
    values
        .iter()
        .map(|value| {
            value
                .get("text")
                .and_then(Value::as_str)
                .filter(|text| !text.trim().is_empty())
                .map(str::to_owned)
                .ok_or_else(|| "DeepL 返回了空译文".into())
        })
        .collect()
}

pub(super) fn validate(request: &BlockTranslationRequest) -> Result<(), String> {
    validate_pair(request.provider, request.source, request.target)?;
    if request.blocks.is_empty() {
        return Err("未发现可翻译的文字".into());
    }
    let mut ids = HashSet::new();
    let mut count = 0usize;
    for block in &request.blocks {
        if !ids.insert(block.id) {
            return Err("翻译文字块标识重复".into());
        }
        if block.text.trim().is_empty() {
            return Err("翻译文字块为空".into());
        }
        count = count.saturating_add(block.text.chars().count());
        if count > 5000 {
            return Err("文字超过 5,000 字符，请缩小选区".into());
        }
    }
    Ok(())
}

pub(super) fn batches(jobs: Vec<(usize, String)>, provider: Provider) -> Vec<Vec<(usize, String)>> {
    let mut output = Vec::new();
    let mut batch = Vec::new();
    let mut characters = 0;
    for job in jobs {
        let length = job.1.chars().count();
        if !batch.is_empty()
            && (batch.len() >= 50 || (provider == Provider::Baidu && characters + 1 + length > 900))
        {
            output.push(std::mem::take(&mut batch));
            characters = 0;
        }
        characters += length + usize::from(!batch.is_empty());
        batch.push(job);
    }
    if !batch.is_empty() {
        output.push(batch);
    }
    output
}

async fn baidu_rate_limit() {
    static NEXT: OnceLock<tokio::sync::Mutex<tokio::time::Instant>> = OnceLock::new();
    let mut next = NEXT
        .get_or_init(|| tokio::sync::Mutex::new(tokio::time::Instant::now()))
        .lock()
        .await;
    if *next > tokio::time::Instant::now() {
        tokio::time::sleep_until(*next).await;
    }
    *next = tokio::time::Instant::now() + Duration::from_secs(1);
}

async fn run(
    config: &TranslationConfig,
    request: BlockTranslationRequest,
) -> Result<Vec<TranslationBlock>, String> {
    validate(&request)?;
    let key = match request.provider {
        Provider::Baidu => config
            .baidu_key
            .as_deref()
            .filter(|key| !key.trim().is_empty())
            .ok_or("请在翻译设置中填写百度 App ID 和密钥")?,
        Provider::Deepl => config
            .deepl_key
            .as_deref()
            .filter(|key| !key.trim().is_empty())
            .ok_or("请在翻译设置中填写 DeepL API Key")?,
    };
    if request.provider == Provider::Baidu && config.baidu_app_id.is_empty() {
        return Err("请在翻译设置中填写百度 App ID".into());
    }
    if request.provider == Provider::Baidu
        && !config.baidu_app_id.chars().all(|c| c.is_ascii_digit())
    {
        return Err("百度 App ID 应为数字，请重新填写".into());
    }
    let client = client()?;
    let mut owners = Vec::new();
    let mut parts = Vec::new();
    for (index, block) in request.blocks.iter().enumerate() {
        for part in split_text(&block.text, request.provider)? {
            owners.push(index);
            parts.push(part);
        }
    }
    let jobs = parts
        .iter()
        .enumerate()
        .filter(|(_, part)| !part.text.trim().is_empty())
        .map(|(index, part)| (index, part.text.clone()))
        .collect();
    let source = language_code(request.provider, request.source, false);
    let target = language_code(request.provider, request.target, true);
    let mut translated = vec![String::new(); parts.len()];
    for batch in batches(jobs, request.provider) {
        let texts = batch
            .iter()
            .map(|(_, text)| text.clone())
            .collect::<Vec<_>>();
        let http = match request.provider {
            Provider::Baidu => {
                baidu_rate_limit().await;
                static NEXT_SALT: AtomicU64 = AtomicU64::new(1);
                let salt = format!(
                    "{}-{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_nanos(),
                    NEXT_SALT.fetch_add(1, Ordering::Relaxed)
                );
                let text = texts.join("\n");
                let sign = baidu_sign(&config.baidu_app_id, &text, &salt, key);
                client
                    .post("https://fanyi-api.baidu.com/api/trans/vip/translate")
                    .form(&[
                        ("q", text.as_str()),
                        ("from", source),
                        ("to", target),
                        ("appid", config.baidu_app_id.as_str()),
                        ("salt", salt.as_str()),
                        ("sign", sign.as_str()),
                    ])
            }
            Provider::Deepl => {
                let mut payload = json!({"text":texts,"target_lang":target});
                if request.source != Language::Auto {
                    payload["source_lang"] = json!(source);
                }
                client
                    .post(if config.deepl_free {
                        "https://api-free.deepl.com/v2/translate"
                    } else {
                        "https://api.deepl.com/v2/translate"
                    })
                    .header("Authorization", format!("DeepL-Auth-Key {key}"))
                    .json(&payload)
            }
        };
        let value = send(http, request.provider)
            .await
            .map_err(|error| format!("翻译请求：{error}"))?;
        let results = parse_batch(request.provider, &value, &texts)
            .map_err(|error| format!("解析译文：{error}"))?;
        for ((index, _), text) in batch.iter().zip(results) {
            translated[*index] = text;
        }
    }
    Ok(merge_parts(&request.blocks, &owners, &parts, &translated))
}

pub(super) fn merge_parts(
    blocks: &[TranslationBlock],
    owners: &[usize],
    parts: &[TextPart],
    translated: &[String],
) -> Vec<TranslationBlock> {
    let mut output = blocks
        .iter()
        .map(|block| TranslationBlock {
            id: block.id,
            text: String::new(),
        })
        .collect::<Vec<_>>();
    for (index, part) in parts.iter().enumerate() {
        output[owners[index]]
            .text
            .push_str(translated[index].trim_end());
        output[owners[index]].text.push_str(&part.separator);
    }
    output
}

pub(super) async fn translate_many(
    config: &TranslationConfig,
    request: BlockTranslationRequest,
) -> Result<Vec<TranslationBlock>, String> {
    let provider = request.provider;
    tokio::time::timeout(Duration::from_secs(30), run(config, request))
        .await
        .map_err(|_| format!("{} · 翻译超时，请重试", provider.label()))?
        .map_err(|error| format!("{} · {error}", provider.label()))
}
