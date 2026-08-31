vc_redist.x64.exe is downloaded from Microsoft and verified by
.github/scripts/prepare-vcredist.mjs immediately before Tauri creates a bundle.

This tracked file keeps the runtime resource glob valid during Rust-only builds.
