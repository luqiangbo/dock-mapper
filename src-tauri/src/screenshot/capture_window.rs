use tauri::WebviewWindow;
use windows::{
    core::BOOL,
    Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED},
};

/// Visibility becomes false before DWM finishes a hide animation. Suppress
/// transitions on our own window until its pixels have been captured.
pub(super) struct CaptureWindowTransition {
    window: WebviewWindow,
}

impl CaptureWindowTransition {
    pub(super) fn suppress(window: &WebviewWindow) -> Result<Self, String> {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        unsafe {
            let disabled = BOOL(1);
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_TRANSITIONS_FORCEDISABLED,
                &disabled as *const _ as _,
                std::mem::size_of::<BOOL>() as u32,
            )
            .map_err(|error| format!("暂停主窗口隐藏动画失败：{error}"))?;
        }
        Ok(Self {
            window: window.clone(),
        })
    }
}

impl Drop for CaptureWindowTransition {
    fn drop(&mut self) {
        if let Ok(hwnd) = self.window.hwnd() {
            let enabled = BOOL(0);
            if let Err(error) = unsafe {
                DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_TRANSITIONS_FORCEDISABLED,
                    &enabled as *const _ as _,
                    std::mem::size_of::<BOOL>() as u32,
                )
            } {
                tracing::warn!(target: "dock_mapper::capture", %error, "恢复主窗口动画状态失败");
            }
        }
    }
}
