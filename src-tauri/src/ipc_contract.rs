#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    #[test]
    fn only_main_can_manage_runtime_or_clear_legacy_mappings_and_system_apply_is_removed() {
        for (source, allowed) in [
            (include_str!("../capabilities/main.json"), true),
            (include_str!("../capabilities/widget.json"), false),
            (
                include_str!("../capabilities/screenshot-overlay.json"),
                false,
            ),
            (include_str!("../capabilities/history-preview.json"), false),
            (include_str!("../capabilities/key-visualizer.json"), false),
        ] {
            let value: serde_json::Value = serde_json::from_str(source).unwrap();
            let permissions = value["permissions"].as_array().unwrap();
            for command in [
                "allow-set-key-mapping-enabled",
                "allow-get-key-mapping-status",
                "allow-get-legacy-key-mappings",
                "allow-clear-legacy-key-mappings",
            ] {
                assert_eq!(permissions.iter().any(|p| p == command), allowed);
            }
            for removed in ["allow-apply-scancode-map", "allow-restore-scancode-map"] {
                assert!(!permissions.iter().any(|p| p == removed));
            }
        }
    }
    #[test]
    fn only_main_window_can_copy_all_or_clear_stored_logs() {
        for (source, allowed) in [
            (include_str!("../capabilities/main.json"), true),
            (include_str!("../capabilities/widget.json"), false),
            (
                include_str!("../capabilities/screenshot-overlay.json"),
                false,
            ),
            (include_str!("../capabilities/history-preview.json"), false),
            (include_str!("../capabilities/key-visualizer.json"), false),
        ] {
            let value: serde_json::Value = serde_json::from_str(source).unwrap();
            for permission in ["allow-get-runtime-log-text", "allow-clear-runtime-logs"] {
                assert_eq!(
                    value["permissions"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|p| p == permission),
                    allowed
                );
            }
        }
    }
    #[test]
    fn build_defaults_reset_is_exclusive_to_main_renderer() {
        for (source, allowed) in [
            (include_str!("../capabilities/main.json"), true),
            (include_str!("../capabilities/widget.json"), false),
            (include_str!("../capabilities/key-visualizer.json"), false),
            (
                include_str!("../capabilities/screenshot-overlay.json"),
                false,
            ),
        ] {
            let value: serde_json::Value = serde_json::from_str(source).unwrap();
            assert_eq!(
                value["permissions"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|p| p == "allow-initialize-defaults"),
                allowed
            );
        }
    }

    #[test]
    fn only_capture_overlays_can_report_capture_startup_failure() {
        for (source, allowed) in [
            (
                include_str!("../capabilities/screenshot-overlay.json"),
                true,
            ),
            (include_str!("../capabilities/main.json"), false),
            (include_str!("../capabilities/history-preview.json"), false),
        ] {
            let value: serde_json::Value = serde_json::from_str(source).unwrap();
            assert_eq!(
                value["permissions"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|p| p == "allow-report-capture-failed"),
                allowed
            );
        }
    }

    #[test]
    fn history_preview_can_read_images_and_control_only_its_own_window() {
        let preview: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/history-preview.json")).unwrap();
        assert_eq!(preview["windows"], serde_json::json!(["history_preview"]));
        let permissions = preview["permissions"].as_array().unwrap();
        for required in [
            "allow-get-screenshot-history-image",
            "allow-get-screenshot-history-preview-session",
            "allow-navigate-screenshot-history-preview",
            "core:window:allow-set-fullscreen",
            "core:window:allow-is-fullscreen",
            "core:window:allow-start-resize-dragging",
        ] {
            assert!(permissions.iter().any(|permission| permission == required));
        }
        for forbidden in [
            "allow-delete-screenshot-history",
            "allow-update-widget-config",
            "allow-open-screenshot-history-preview",
            "core:window:allow-is-visible",
        ] {
            assert!(!permissions.iter().any(|permission| permission == forbidden));
        }
        let main: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
        assert!(main["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|permission| permission == "allow-open-screenshot-history-preview"));
    }

    #[test]
    fn shared_contract_matches_registered_tauri_commands() {
        let source = include_str!("lib.rs");
        let handler = source
            .split(".invoke_handler(tauri::generate_handler![")
            .nth(1)
            .and_then(|value| value.split("])").next())
            .expect("locate the Tauri handler list");
        let registered = handler
            .lines()
            .filter_map(|line| {
                let path = line.trim().strip_suffix(',')?;
                path.rsplit("::").next()
            })
            .collect::<BTreeSet<_>>();

        let contract: serde_json::Value =
            serde_json::from_str(include_str!("../../ipc-contract.json"))
                .expect("parse the shared IPC contract");
        let declared = contract["commands"]
            .as_array()
            .expect("contract commands")
            .iter()
            .map(|value| value.as_str().expect("command name"))
            .collect::<BTreeSet<_>>();

        assert_eq!(registered, declared);
    }
    #[test]
    fn updater_can_report_download_and_install_as_separate_stages() {
        let main: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
        let permissions = main["permissions"].as_array().unwrap();
        for name in [
            "updater:allow-check",
            "updater:allow-download",
            "updater:allow-install",
            "process:allow-restart",
            "core:resources:allow-close",
        ] {
            assert!(permissions.iter().any(|permission| permission == name));
        }
    }
    #[test]
    fn only_main_window_can_read_and_append_runtime_logs() {
        let main: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
        for permission in ["allow-get-runtime-logs", "allow-append-runtime-log"] {
            assert!(main["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p == permission));
            let preview: serde_json::Value =
                serde_json::from_str(include_str!("../capabilities/history-preview.json")).unwrap();
            assert!(!preview["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p == permission));
        }
    }

    #[test]
    fn widget_space_status_can_be_requested_and_reported_by_both_windows() {
        let main: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
        assert!(main["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p == "allow-refresh-widget-position"));
        for (name, source) in [
            ("主窗口", include_str!("../capabilities/main.json")),
            ("任务栏挂件", include_str!("../capabilities/widget.json")),
        ] {
            let capability: serde_json::Value =
                serde_json::from_str(source).expect("parse capability");
            let permissions = capability["permissions"].as_array().expect("permissions");
            assert!(
                permissions
                    .iter()
                    .any(|permission| permission == "core:event:allow-emit"),
                "{name}必须允许发送布局事件"
            );
        }
    }
}
