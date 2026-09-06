use windows::{
    core::{w, PCWSTR},
    Win32::{
        Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM},
        System::{LibraryLoader::GetModuleHandleW, Threading::GetCurrentThreadId},
        UI::{
            Input::{
                GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE,
                RIDEV_INPUTSINK, RIDEV_REMOVE, RID_INPUT, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
            },
            WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos,
                GetMessageW, GetWindowLongPtrW, KillTimer, RegisterClassW, SetTimer,
                SetWindowLongPtrW, TranslateMessage, CREATESTRUCTW, GWLP_USERDATA, HWND_MESSAGE,
                MSG, RI_KEY_BREAK, WINDOW_EX_STYLE, WINDOW_STYLE, WM_INPUT, WM_NCCREATE, WM_TIMER,
                WNDCLASSW,
            },
        },
    },
};

use crate::{config, key_visualizer::InputProcessor};
use std::{mem::size_of, sync::mpsc};
use tauri::AppHandle;
use windows::Win32::{Foundation::POINT, UI::Input::KeyboardAndMouse::GetKeyState};

struct NativeProcessor {
    keys: InputProcessor,
    app: AppHandle,
    generation: u64,
    mouse: bool,
    locks: bool,
    lock_tracker: LockTracker,
    last_lock_sample: std::time::Instant,
}

#[derive(Default)]
struct LockTracker(Option<(bool, bool)>);

impl LockTracker {
    fn observe(&mut self, value: (bool, bool)) -> bool {
        if self.0 == Some(value) {
            return false;
        }
        self.0 = Some(value);
        true
    }
}

impl NativeProcessor {
    fn tick(&mut self) {
          if self.mouse {
            let mut point = POINT::default();
            match unsafe { GetCursorPos(&mut point) } {
                Ok(()) => {
                    crate::presentation::mouse(
                        &self.app,
                        self.generation,
                        point.x,
                        point.y,
                        "move",
                    );
                }
                Err(error) => crate::presentation::report_input_error(
                    &self.app,
                    self.generation,
                    format!("读取鼠标位置失败：{error}"),
                ),
            }
        }
        if self.locks && self.last_lock_sample.elapsed().as_millis() >= 100 {
            self.last_lock_sample = std::time::Instant::now();
            // Sample Windows' toggle bits after pumping the input queue, never infer
            // the state from the number of raw key-down or auto-repeat messages.
            let value = unsafe { (GetKeyState(0x14) & 1 != 0, GetKeyState(0x90) & 1 != 0) };
            if self.lock_tracker.observe(value) {
                crate::presentation::lock_state(&self.app, self.generation, value.0, value.1);
            }
        }
    }
}

unsafe extern "system" fn raw_input_wnd_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_NCCREATE {
        let create = &*(lparam.0 as *const CREATESTRUCTW);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, create.lpCreateParams as isize);
    } else if message == WM_TIMER {
        let pointer = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut NativeProcessor;
        if !pointer.is_null() {
            (*pointer).tick();
        }
    } else if message == WM_INPUT {
        let pointer = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut NativeProcessor;
        if !pointer.is_null() {
            let mut input = RAWINPUT::default();
            let mut size = size_of::<RAWINPUT>() as u32;
            let read = GetRawInputData(
                HRAWINPUT(lparam.0 as *mut _),
                RID_INPUT,
                Some((&mut input as *mut RAWINPUT).cast()),
                &mut size,
                size_of::<windows::Win32::UI::Input::RAWINPUTHEADER>() as u32,
            );
            if read != u32::MAX && input.header.dwType == RIM_TYPEKEYBOARD.0 {
                let keyboard = input.data.keyboard;
                (*pointer)
                    .keys
                    .handle(keyboard.VKey, keyboard.Flags as u32 & RI_KEY_BREAK == 0);
            } else if read != u32::MAX && input.header.dwType == RIM_TYPEMOUSE.0 {
                let flags = input.data.mouse.Anonymous.Anonymous.usButtonFlags;
                let mut point = POINT::default();
                if GetCursorPos(&mut point).is_ok() {
                    for (flag, kind) in [(1, "left"), (4, "right"), (16, "middle")] {
                        if flags & flag != 0 {
                            crate::presentation::mouse(
                                &(*pointer).app,
                                (*pointer).generation,
                                point.x,
                                point.y,
                                kind,
                            );
                        }
                    }
                }
            }
        }
    }
    DefWindowProcW(hwnd, message, wparam, lparam)
}

pub(crate) fn raw_input_thread(
    app: AppHandle,
    config: config::KeyVisualizerConfig,
    ready: mpsc::SyncSender<Result<u32, String>>,
) {
    unsafe {
        let thread_id = GetCurrentThreadId();
        let module = match GetModuleHandleW(PCWSTR::null()) {
            Ok(module) => module,
            Err(error) => {
                let _ = ready.send(Err(format!("读取程序模块失败：{error}")));
                return;
            }
        };
        let class = WNDCLASSW {
            hInstance: HINSTANCE(module.0),
            lpszClassName: w!("DockMapperKeyVisualizerRawInput"),
            lpfnWndProc: Some(raw_input_wnd_proc),
            ..Default::default()
        };
        RegisterClassW(&class);
        let status = crate::presentation::snapshot(&app);
        let active = status.enabled && !status.suspended;
        let mouse = active && (status.config.clicks || status.config.highlight);
        let locks = active && status.config.lock_keys;
        let mut processor = Box::new(NativeProcessor {
            keys: InputProcessor::new(app.clone(), config),
            app,
            generation: status.generation,
            mouse: active && status.config.highlight,
            locks,
            lock_tracker: LockTracker::default(),
            last_lock_sample: std::time::Instant::now(),
        });
        let hwnd = match CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class.lpszClassName,
            w!("DockMapper Raw Input"),
            WINDOW_STYLE::default(),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(class.hInstance),
            Some((&mut *processor as *mut NativeProcessor).cast()),
        ) {
            Ok(hwnd) => hwnd,
            Err(error) => {
                let _ = ready.send(Err(format!("创建按键监听窗口失败：{error}")));
                return;
            }
        };
        let mut devices = vec![RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x06,
            dwFlags: RIDEV_INPUTSINK,
            hwndTarget: hwnd,
        }];
        if mouse {
            devices.push(RAWINPUTDEVICE {
                usUsagePage: 1,
                usUsage: 2,
                dwFlags: RIDEV_INPUTSINK,
                hwndTarget: hwnd,
            });
        }
        if let Err(error) = RegisterRawInputDevices(&devices, size_of::<RAWINPUTDEVICE>() as u32) {
            let _ = DestroyWindow(hwnd);
            let _ = ready.send(Err(format!("注册 Raw Input 键盘失败：{error}")));
            return;
        }
          let timer_needed = processor.mouse || locks;
        if timer_needed
            && SetTimer(Some(hwnd), 1, if processor.mouse { 17 } else { 100 }, None) == 0
        {
            for device in &mut devices {
                device.dwFlags = RIDEV_REMOVE;
                device.hwndTarget = HWND::default();
            }
            let _ = RegisterRawInputDevices(&devices, size_of::<RAWINPUTDEVICE>() as u32);
            let _ = DestroyWindow(hwnd);
            let _ = ready.send(Err("启动演示采样定时器失败".into()));
            return;
        }
        let accepted = ready.send(Ok(thread_id)).is_ok();
        let mut message = MSG::default();
        while accepted {
            let result = GetMessageW(&mut message, None, 0, 0);
            if result.0 <= 0 {
                break;
            }
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        if timer_needed {
            let _ = KillTimer(Some(hwnd), 1);
        }
        for device in &mut devices {
            device.dwFlags = RIDEV_REMOVE;
            device.hwndTarget = HWND::default();
        }
        let _ = RegisterRawInputDevices(&devices, size_of::<RAWINPUTDEVICE>() as u32);
        let _ = DestroyWindow(hwnd);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lock_prompt_uses_initial_and_changed_system_values_without_toggling_on_repeats() {
        let mut tracker = LockTracker::default();
        assert!(tracker.observe((true, false)));
        assert!(!tracker.observe((true, false)));
        assert!(tracker.observe((false, false)));
        assert!(tracker.observe((false, true)));
        assert!(!tracker.observe((false, true)));
    }
}
