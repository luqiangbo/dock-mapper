use std::os::windows::ffi::OsStrExt;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
use windows::Win32::System::Threading::OpenProcessToken;
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

/// Returns `true` if the current process is running with elevated
/// (administrator) privileges.
pub fn is_elevated() -> bool {
    unsafe {
        // GetCurrentProcess() returns the pseudo-handle -1
        let process = HANDLE((-1isize) as *mut _);
        let mut token_handle = HANDLE::default();

        if OpenProcessToken(process, TOKEN_QUERY, &mut token_handle).is_err() {
            eprintln!("[admin] OpenProcessToken failed");
            return false;
        }

        let mut elevation = TOKEN_ELEVATION::default();
        let mut return_len: u32 = 0;

        if GetTokenInformation(
            token_handle,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut _),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut return_len,
        )
        .is_err()
        {
            eprintln!("[admin] GetTokenInformation failed");
            return false;
        }

        elevation.TokenIsElevated != 0
    }
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
        let result = ShellExecuteW(
            None,
            windows::core::PCWSTR::from_raw(verb_wide.as_ptr()),
            windows::core::PCWSTR::from_raw(exe_wide.as_ptr()),
            windows::core::PCWSTR::null(),
            None,
            SW_SHOWNORMAL,
        );

        // ShellExecuteW returns HINSTANCE; value <= 32 indicates an error.
        if (result.0 as isize) <= 32 {
            eprintln!("[admin] relaunch ShellExecuteW failed: {:?}", result.0);
        }
    }
}
