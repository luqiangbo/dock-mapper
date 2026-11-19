use super::AppConfig;
use std::path::Path;

/// Legacy installer tokens are intentionally ignored. Reinstallation preserves data.
pub fn load_for_installation(
    path: &Path,
    _token_path: &Path,
) -> std::io::Result<(AppConfig, Option<String>, bool)> {
    Ok((super::load(path), None, false))
}
