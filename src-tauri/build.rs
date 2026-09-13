fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=../ipc-contract.json");

    let contract = std::fs::read_to_string("../ipc-contract.json")
        .expect("failed to read the shared IPC contract");
    let contract: serde_json::Value =
        serde_json::from_str(&contract).expect("failed to parse the shared IPC contract");
    let commands = contract["commands"]
        .as_array()
        .expect("IPC contract commands must be an array")
        .iter()
        .map(|command| {
            let command = command
                .as_str()
                .expect("IPC contract command names must be strings")
                .to_owned();
            &*Box::leak(command.into_boxed_str())
        })
        .collect::<Vec<&'static str>>();
    let commands = Box::leak(commands.into_boxed_slice());
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("failed to build DockMapper Tauri context")
}
