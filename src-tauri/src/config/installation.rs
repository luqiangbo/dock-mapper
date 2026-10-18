use std::path::Path;

pub fn prepare_installation(
    app: &tauri::App,
    config_path: &Path,
    token_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let token = match std::fs::read_to_string(token_path) {
        Ok(token) => token,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if !token.trim().is_empty()
        && super::load(config_path).installation_id.as_deref() != Some(token.trim())
    {
        // Complete the OS preference before committing the new installation ID;
        // failure must remain retryable on the next launch.
        crate::autostart_reset::ensure_disabled(app.handle())?;
    }
    Ok(())
}
