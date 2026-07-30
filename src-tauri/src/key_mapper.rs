use crate::{EngineStatus, KeyMapping};
use std::{
    collections::HashMap,
    mem::size_of,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex, OnceLock, RwLock,
    },
};
use windows::Win32::{
    Foundation::{LPARAM, LRESULT, WPARAM},
    System::Threading::GetCurrentThreadId,
    UI::{
        Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
            KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, VIRTUAL_KEY,
        },
        WindowsAndMessaging::{
            CallNextHookEx, GetMessageW, PostThreadMessageW, SetWindowsHookExW,
            UnhookWindowsHookEx, HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG, WH_KEYBOARD_LL,
            WM_KEYDOWN, WM_KEYUP, WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP,
        },
    },
};

static HOOK_ENGINE: OnceLock<Arc<KeyMapperEngine>> = OnceLock::new();

#[derive(Clone, Copy)]
struct KeyTarget {
    vk: u16,
    extended: bool,
}

pub struct KeyMapperEngine {
    mappings: RwLock<Vec<KeyMapping>>,
    runtime_map: RwLock<HashMap<u32, KeyTarget>>,
    active_keys: Mutex<HashMap<u32, KeyTarget>>,
    enabled: AtomicBool,
    running: AtomicBool,
    last_error: Mutex<Option<String>>,
    thread_id: AtomicU32,
}

impl KeyMapperEngine {
    pub fn new(mappings: Vec<KeyMapping>, enabled: bool) -> Result<Arc<Self>, String> {
        let engine = Arc::new(Self {
            mappings: RwLock::new(Vec::new()),
            runtime_map: RwLock::new(HashMap::new()),
            active_keys: Mutex::new(HashMap::new()),
            enabled: AtomicBool::new(enabled),
            running: AtomicBool::new(false),
            last_error: Mutex::new(None),
            thread_id: AtomicU32::new(0),
        });
        engine.sync_mappings(mappings)?;
        Ok(engine)
    }

    pub fn mappings(&self) -> Result<Vec<KeyMapping>, String> {
        self.mappings
            .read()
            .map(|items| items.clone())
            .map_err(|_| "按键映射状态已损坏".to_string())
    }

    pub fn sync_mappings(&self, mappings: Vec<KeyMapping>) -> Result<(), String> {
        let mut runtime_map = HashMap::new();
        for mapping in &mappings {
            if mapping.source_key == mapping.target_key {
                return Err(format!("规则 {} 的源按键与目标按键相同", mapping.id));
            }
            if mapping.enabled
                && runtime_map
                    .insert(
                        mapping.source_key.vk() as u32,
                        KeyTarget {
                            vk: mapping.target_key.vk(),
                            extended: mapping.target_key.is_extended(),
                        },
                    )
                    .is_some()
            {
                return Err(format!("存在重复的源按键：{}", mapping.source_key.code()));
            }
        }

        *self
            .runtime_map
            .write()
            .map_err(|_| "按键查找表状态已损坏".to_string())? = runtime_map;
        *self
            .mappings
            .write()
            .map_err(|_| "按键规则状态已损坏".to_string())? = mappings;
        Ok(())
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Release);
        if !enabled {
            self.release_active_keys();
        }
    }

    pub fn status(&self) -> EngineStatus {
        EngineStatus {
            running: self.running.load(Ordering::Acquire),
            enabled: self.enabled.load(Ordering::Acquire),
            last_error: self.last_error.lock().ok().and_then(|value| value.clone()),
        }
    }

    pub fn start(self: &Arc<Self>) -> Result<(), String> {
        HOOK_ENGINE
            .set(self.clone())
            .map_err(|_| "键盘钩子已经初始化".to_string())?;

        std::thread::Builder::new()
            .name("dock-mapper-keyboard-hook".into())
            .spawn(|| unsafe {
                let Some(engine) = HOOK_ENGINE.get() else {
                    return;
                };
                engine
                    .thread_id
                    .store(GetCurrentThreadId(), Ordering::Release);

                let hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_callback), None, 0) {
                    Ok(hook) => hook,
                    Err(error) => {
                        *engine.last_error.lock().expect("last_error poisoned") =
                            Some(format!("安装键盘钩子失败：{error}"));
                        engine.thread_id.store(0, Ordering::Release);
                        return;
                    }
                };

                engine.running.store(true, Ordering::Release);
                *engine.last_error.lock().expect("last_error poisoned") = None;

                let mut message = MSG::default();
                while GetMessageW(&mut message, None, 0, 0).as_bool() {}

                let _ = UnhookWindowsHookEx(hook);
                engine.running.store(false, Ordering::Release);
                engine.thread_id.store(0, Ordering::Release);
            })
            .map_err(|error| format!("创建键盘钩子线程失败：{error}"))?;

        Ok(())
    }

    pub fn stop(&self) {
        self.enabled.store(false, Ordering::Release);
        self.release_active_keys();
        let thread_id = self.thread_id.load(Ordering::Acquire);
        if thread_id != 0 {
            unsafe {
                let _ = PostThreadMessageW(thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
            }
        }
    }

    fn release_active_keys(&self) {
        let active = self
            .active_keys
            .lock()
            .map(|mut keys| keys.drain().map(|(_, target)| target).collect::<Vec<_>>())
            .unwrap_or_default();
        for target in active {
            let _ = send_key(target, true);
        }
    }
}

unsafe extern "system" fn hook_callback(code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let event = &*(l_param.0 as *const KBDLLHOOKSTRUCT);
        if event.flags.0 & LLKHF_INJECTED.0 == 0 {
            if let Some(engine) = HOOK_ENGINE.get() {
                let message = w_param.0 as u32;
                let key_up = message == WM_KEYUP || message == WM_SYSKEYUP;
                let key_down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;

                if key_up {
                    let target = engine
                        .active_keys
                        .lock()
                        .ok()
                        .and_then(|mut keys| keys.remove(&event.vkCode));
                    if let Some(target) = target {
                        if send_key(target, true) {
                            return LRESULT(1);
                        }
                    }
                } else if key_down {
                    let target = engine
                        .runtime_map
                        .read()
                        .ok()
                        .and_then(|map| map.get(&event.vkCode).copied());

                    if let Some(target) = target {
                        let should_send = engine
                            .active_keys
                            .lock()
                            .map(|mut keys| {
                                if engine.enabled.load(Ordering::Acquire) {
                                    keys.insert(event.vkCode, target);
                                    true
                                } else {
                                    false
                                }
                            })
                            .unwrap_or(false);
                        if should_send {
                            if send_key(target, false) {
                                return LRESULT(1);
                            }
                            if let Ok(mut keys) = engine.active_keys.lock() {
                                keys.remove(&event.vkCode);
                            }
                        }
                    }
                }
            }
        }
    }

    CallNextHookEx(None, code, w_param, l_param)
}

fn send_key(target: KeyTarget, key_up: bool) -> bool {
    let mut flags = KEYBD_EVENT_FLAGS(0);
    if target.extended {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    if key_up {
        flags |= KEYEVENTF_KEYUP;
    }

    let input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(target.vk),
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };

    unsafe { SendInput(&[input], size_of::<INPUT>() as i32) == 1 }
}
