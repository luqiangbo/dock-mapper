/// Returns `true` if the current process is running with elevated
/// (administrator) privileges.
pub fn is_elevated() -> bool {
    is_elevated::is_elevated()
}

/// Relaunch the current executable with the `runas` verb (UAC elevation
/// dialog). The caller should exit the current process immediately after.
pub fn relaunch_as_admin() {
    let exe_path = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[admin] Cannot get exe path: {e}");
            return;
        }
    };

    // Use ShellExecuteW via windows crate
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let exe_wide: Vec<u16> = exe_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let verb_wide: Vec<u16> = std::ffi::OsStr::new("runas")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let result = windows::Win32::UI::Shell::ShellExecuteW(
            None,
            windows::core::PCWSTR::from_raw(verb_wide.as_ptr()),
            windows::core::PCWSTR::from_raw(exe_wide.as_ptr()),
            windows::core::PCWSTR::null(),
            None,
            SW_SHOWNORMAL,
        );

        // ShellExecuteW returns HINSTANCE; value <= 32 indicates an error.
        if result.0 as isize <= 32 {
            eprintln!("[admin] relaunch ShellExecuteW failed: {:?}", result.0);
        }
    }
}
