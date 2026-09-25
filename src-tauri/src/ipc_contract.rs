#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

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
    fn widget_space_status_can_be_requested_and_reported_by_both_windows() {
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
