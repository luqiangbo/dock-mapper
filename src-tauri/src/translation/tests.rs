use super::{providers::*, settings::*, *};
use serde_json::json;
use std::sync::Arc;

fn draft(config: &TranslationConfig) -> SettingsDraft {
    SettingsDraft {
        provider: config.provider,
        source: config.source,
        target: config.target,
        deepl_free: config.deepl_free,
        baidu_app_id: config.baidu_app_id.clone(),
        baidu_key: None,
        deepl_key: None,
    }
}

#[test]
fn only_tested_credentials_can_become_default_and_replacing_key_requires_retest() {
    let current = TranslationConfig::default();
    let mut update = draft(&current);
    update.provider = Provider::Deepl;
    update.deepl_key = Some("verified-gate-test-unique-key".into());
    let untested = apply(&current, update).unwrap();
    assert!(!verified(&untested, Provider::Deepl));
    remember_test(&untested);
    let tested = apply(&untested, draft(&untested)).unwrap();
    assert!(verified(&tested, Provider::Deepl));
    let reopened: TranslationConfig =
        serde_json::from_str(&serde_json::to_string(&tested).unwrap()).unwrap();
    assert!(reopened.deepl_verified);
    let mut changed = draft(&tested);
    changed.deepl_key = Some("changed-unverified-key".into());
    assert!(!apply(&tested, changed).unwrap().deepl_verified);
}

#[test]
fn saving_an_untested_service_preserves_the_active_service_and_credentials() {
    let root = directory();
    let history = Arc::new(crate::history::HistoryStore::new(root.join("history")).unwrap());
    let state = AppState::new(
        crate::config::AppConfig::default(),
        root.join("config.json"),
        history,
    );
    let mut update = draft(&TranslationConfig::default());
    update.provider = Provider::Deepl;
    update.deepl_key = Some("saved-but-not-tested-key".into());
    let saved = save_settings(&state, update).unwrap();
    assert_eq!(saved.provider, Provider::Baidu);
    assert!(saved.deepl_key_configured);
    assert!(!saved.deepl_verified);
    std::fs::remove_dir_all(root).unwrap();
}
fn directory() -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "dockmapper-official-translation-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

#[test]
fn old_provider_choices_migrate_to_official_baidu_without_resetting_other_preferences() {
    for old in ["bing", "google", "tencent", "mymemory", "microsoft"] {
        let mut config: crate::config::AppConfig = serde_json::from_value(json!({"screenshot_config":{"filename_prefix":"Keep"},"translation_config":{"provider":old,"source":"ja","target":"zh"}})).unwrap();
        crate::config::normalize_loaded_config(&mut config);
        assert_eq!(config.translation_config.provider, Provider::Baidu);
        assert_eq!(config.translation_config.source, Language::Ja);
        assert_eq!(config.screenshot_config.filename_prefix, "Keep");
    }
    assert_eq!(TranslationConfig::default().provider, Provider::Baidu);
    let invalid_draft =
        json!({"provider":"bing","source":"auto","target":"zh","deeplFree":true,"baiduAppId":""});
    assert!(serde_json::from_value::<SettingsDraft>(invalid_draft).is_err());
}

#[test]
fn credentials_are_saved_plaintext_and_survive_reopening_provider_switching_and_explicit_clear() {
    let root = directory();
    let path = root.join("config.json");
    let history = Arc::new(crate::history::HistoryStore::new(root.join("history")).unwrap());
    let state = AppState::new(crate::config::AppConfig::default(), path.clone(), history);
    let mut update = draft(&TranslationConfig::default());
    update.baidu_app_id = "123456".into();
    update.baidu_key = Some("baidu-personal-key".into());
    update.deepl_key = Some("deepl-personal-key".into());
    let view = save_settings(&state, update).unwrap();
    assert!(view.baidu_key_configured && view.deepl_key_configured);
    let disk = std::fs::read_to_string(&path).unwrap();
    assert!(disk.contains("baidu-personal-key") && disk.contains("deepl-personal-key"));
    assert!(!disk.contains("Encrypted"));
    let mut config = crate::config::load_for_mutation(&path).unwrap();
    let mut update = draft(&config.translation_config);
    update.provider = Provider::Deepl;
    save_settings(&state, update).unwrap();
    config = crate::config::load_for_mutation(&path).unwrap();
    assert_eq!(
        config.translation_config.baidu_key.as_deref(),
        Some("baidu-personal-key")
    );
    assert_eq!(
        config.translation_config.deepl_key.as_deref(),
        Some("deepl-personal-key")
    );
    let public = serde_json::to_string(&SettingsView::from(&config.translation_config)).unwrap();
    assert!(!public.contains("personal-key"));
    let debug = format!("{:?}", config);
    assert!(!debug.contains("personal-key"));
    let mut clear = draft(&config.translation_config);
    clear.deepl_key = Some(String::new());
    save_settings(&state, clear).unwrap();
    let reopened = crate::config::load_for_mutation(&path).unwrap();
    assert!(reopened.translation_config.deepl_key.is_none());
    assert!(reopened.translation_config.baidu_key.is_some());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn previous_deepl_encryption_is_read_once_and_next_save_uses_plaintext() {
    let encrypted = secret::encrypt_fixture("legacy-deepl-key");
    let mut config: crate::config::AppConfig = serde_json::from_value(
        json!({"translation_config":{"provider":"deepl","deeplKeyEncrypted":encrypted}}),
    )
    .unwrap();
    crate::config::normalize_loaded_config(&mut config);
    assert_eq!(
        config.translation_config.deepl_key.as_deref(),
        Some("legacy-deepl-key")
    );
    let serialized = serde_json::to_string(&config).unwrap();
    assert!(serialized.contains("legacy-deepl-key"));
    assert!(!serialized.contains("deeplKeyEncrypted"));
    assert!(config.translation_config.credential_error.is_none());
}

#[test]
fn unreadable_old_credentials_preserve_other_settings_and_can_be_replaced() {
    let mut config: TranslationConfig = serde_json::from_value(
        json!({"provider":"deepl","source":"ko","deeplKeyEncrypted":"broken-ciphertext"}),
    )
    .unwrap();
    config.migrate_legacy_key();
    assert_eq!(config.source, Language::Ko);
    assert!(config.credential_error.is_some());
    let mut update = draft(&config);
    update.deepl_key = Some("new-key".into());
    let replaced = apply(&config, update).unwrap();
    assert_eq!(replaced.deepl_key.as_deref(), Some("new-key"));
    assert!(replaced.legacy_deepl_key_encrypted.is_none() && replaced.credential_error.is_none());
}

#[test]
fn failed_write_keeps_current_credentials_and_allows_retry() {
    let root = directory();
    let history = Arc::new(crate::history::HistoryStore::new(root.join("history")).unwrap());
    let blocker = root.join("file");
    std::fs::write(&blocker, "block").unwrap();
    let mut state = AppState::new(
        crate::config::AppConfig::default(),
        blocker.join("config.json"),
        history,
    );
    let mut update = draft(&TranslationConfig::default());
    update.provider = Provider::Deepl;
    update.deepl_key = Some("new-key".into());
    assert!(save_settings(&state, update).is_err());
    assert_eq!(snapshot(&state).unwrap().provider, Provider::Baidu);
    assert!(snapshot(&state).unwrap().deepl_key.is_none());
    state.config_path = root.join("config.json");
    let mut update = draft(&TranslationConfig::default());
    update.provider = Provider::Deepl;
    update.deepl_key = Some("retry-tested-key".into());
    let tested = apply(&TranslationConfig::default(), update).unwrap();
    remember_test(&tested);
    let mut update = draft(&tested);
    update.deepl_key = tested.deepl_key.clone();
    save_settings(&state, update).unwrap();
    assert_eq!(snapshot(&state).unwrap().provider, Provider::Deepl);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn baidu_signature_uses_original_text_before_url_encoding_and_expected_order() {
    assert_eq!(
        super::blocks::baidu_sign("a", "b", "c", ""),
        "900150983cd24fb0d6963f7d28e17f72"
    );
    assert_ne!(
        super::blocks::baidu_sign("app", "hello world", "salt", "key"),
        super::blocks::baidu_sign("app", "hello+world", "salt", "key")
    );
}

#[test]
fn official_services_map_chinese_japanese_and_korean_to_expected_codes() {
    assert_eq!(language_code(Provider::Baidu, Language::Ja, false), "jp");
    assert_eq!(language_code(Provider::Baidu, Language::Ko, true), "kor");
    assert_eq!(
        language_code(Provider::Baidu, Language::Auto, false),
        "auto"
    );
    assert_eq!(
        language_code(Provider::Deepl, Language::Zh, true),
        "ZH-HANS"
    );
    assert_eq!(language_code(Provider::Deepl, Language::En, true), "EN-US");
}

#[test]
fn unicode_and_multiline_blocks_split_losslessly_and_baidu_batches_stay_small() {
    let text = format!("{}\n{}\r\n\nhello", "日".repeat(500), "🙂".repeat(600));
    for provider in [Provider::Baidu, Provider::Deepl] {
        let parts = split_text(&text, provider).unwrap();
        assert_eq!(
            parts
                .iter()
                .map(|part| part.text.clone() + &part.separator)
                .collect::<String>(),
            text
        );
        assert!(parts.iter().all(|part| !part.text.contains('\n')));
        let jobs = parts
            .iter()
            .enumerate()
            .filter(|(_, part)| !part.text.is_empty())
            .map(|(index, part)| (index, part.text.clone()))
            .collect();
        for batch in super::blocks::batches(jobs, provider) {
            assert!(batch.len() <= 50);
            if provider == Provider::Baidu {
                assert!(
                    batch
                        .iter()
                        .map(|(_, text)| text.as_str())
                        .collect::<Vec<_>>()
                        .join("\n")
                        .chars()
                        .count()
                        <= 900
                );
            }
        }
    }
}

#[test]
fn batched_results_match_source_lines_and_reject_partial_or_reordered_translations() {
    let texts = vec!["Hello".into(), "world".into()];
    assert_eq!(
        super::blocks::parse_batch(
            Provider::Baidu,
            &json!({"trans_result":[{"src":"Hello","dst":"你好"},{"src":"world","dst":"世界"}]}),
            &texts
        )
        .unwrap(),
        vec!["你好", "世界"]
    );
    assert!(super::blocks::parse_batch(
        Provider::Baidu,
        &json!({"trans_result":[{"src":"world","dst":"世界"},{"src":"Hello","dst":"你好"}]}),
        &texts
    )
    .is_err());
    assert!(
        super::blocks::parse_batch(Provider::Baidu, &json!({"trans_result":[]}), &texts).is_err()
    );
    assert_eq!(
        super::blocks::parse_batch(
            Provider::Deepl,
            &json!({"translations":[{"text":"你好"},{"text":"世界"}]}),
            &texts
        )
        .unwrap(),
        vec!["你好", "世界"]
    );
}

#[test]
fn credential_frequency_and_quota_errors_explain_what_to_fix_without_echoing_keys() {
    for (code, expected) in [
        ("54001", "密钥"),
        ("54003", "频率"),
        ("54004", "额度"),
        ("58001", "语言"),
    ] {
        let error = super::blocks::parse_batch(
            Provider::Baidu,
            &json!({"error_code":code,"error_msg":"private key or source text"}),
            &["Hello".into()],
        )
        .unwrap_err();
        assert!(error.contains(expected));
        assert!(!error.contains("private key"));
    }
    assert!(status_error(456, Provider::Deepl, &json!(null)).contains("额度"));
}

#[test]
fn block_parts_merge_back_into_stable_ids() {
    let blocks = vec![
        TranslationBlock {
            id: 9,
            text: "a".repeat(600),
        },
        TranslationBlock {
            id: 2,
            text: "hello".into(),
        },
    ];
    let mut parts = split_text(&blocks[0].text, Provider::Deepl).unwrap();
    parts.extend(split_text(&blocks[1].text, Provider::Deepl).unwrap());
    let output = super::blocks::merge_parts(
        &blocks,
        &[0, 0, 1],
        &parts,
        &["前半".into(), "后半".into(), "你好".into()],
    );
    assert_eq!(output[0].id, 9);
    assert_eq!(output[0].text, "前半后半");
    assert_eq!(output[1].id, 2);
}

#[test]
fn trial_uses_custom_text_and_rejects_empty_or_oversized_input() {
    let config = TranslationConfig::default();
    assert_eq!(
        super::trial_request(&config, "こんにちは".into())
            .unwrap()
            .text,
        "こんにちは"
    );
    assert!(super::trial_request(&config, " ".into()).is_err());
    assert!(super::trial_request(&config, "🙂".repeat(5001)).is_err());
}

#[test]
fn overall_character_limit_and_block_id_validation_remain_in_place() {
    let mut request = BlockTranslationRequest {
        provider: Provider::Baidu,
        source: Language::Auto,
        target: Language::Zh,
        blocks: vec![TranslationBlock {
            id: 1,
            text: "字".repeat(5000),
        }],
    };
    assert!(super::blocks::validate(&request).is_ok());
    request.blocks[0].text.push('字');
    assert!(super::blocks::validate(&request).is_err());
    request.blocks[0].text = "Hello".into();
    request.blocks.push(TranslationBlock {
        id: 1,
        text: "world".into(),
    });
    assert!(super::blocks::validate(&request).is_err());
}

#[test]
fn only_main_can_mutate_or_test_credentials_and_only_main_and_capture_can_translate() {
    for (source, read, write) in [
        (include_str!("../../capabilities/main.json"), true, true),
        (
            include_str!("../../capabilities/screenshot-overlay.json"),
            true,
            false,
        ),
        (
            include_str!("../../capabilities/pinned-image.json"),
            false,
            false,
        ),
        (include_str!("../../capabilities/widget.json"), false, false),
        (
            include_str!("../../capabilities/history-preview.json"),
            false,
            false,
        ),
    ] {
        let value: serde_json::Value = serde_json::from_str(source).unwrap();
        let permissions = value["permissions"].as_array().unwrap();
        for (name, allowed) in [
            ("get-translation-settings", read),
            ("translate-text", read),
            ("translate-ocr-blocks", read),
            ("update-translation-settings", write),
            ("test-translation-service", write),
        ] {
            assert_eq!(
                permissions
                    .iter()
                    .any(|value| value == &format!("allow-{name}")),
                allowed
            );
        }
    }
}

#[test]
fn application_links_are_allowed_in_main_browser_opener_scope() {
    let value: serde_json::Value =
        serde_json::from_str(include_str!("../../capabilities/main.json")).unwrap();
    let scope = value["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|permission| permission["identifier"] == "opener:allow-open-url")
        .unwrap();
    for url in [
        "https://fanyi-api.baidu.com/manage/developer",
        "https://www.deepl.com/pro-api",
        "https://github.com/luqiangbo/dock-mapper*",
    ] {
        assert!(scope["allow"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["url"] == url));
    }
}
