use super::engine::{Engine, Rules};
use std::{
    cell::{Cell, RefCell},
    sync::{
        atomic::{AtomicU8, Ordering},
        mpsc, Arc,
    },
    thread,
};
use tauri::{AppHandle, Emitter};
use windows::Win32::{
    Foundation::{CloseHandle, HANDLE, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM},
    Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
    System::{
        LibraryLoader::GetModuleHandleW,
        Threading::{
            GetCurrentProcess, GetCurrentThreadId, OpenProcess, OpenProcessToken,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
    },
    UI::{
        Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK},
        Input::KeyboardAndMouse::{
            GetAsyncKeyState, MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD,
            KEYBDINPUT, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE,
            MAPVK_VSC_TO_VK_EX,
        },
        WindowsAndMessaging::*,
    },
};
const UPDATE: u32 = WM_APP + 31;
const HEALTH: u32 = WM_APP + 32;
const ACCESS: u32 = WM_APP + 33;
const MARKER: usize = 0x444f434b4d415050;
thread_local! {
    static ENGINE: RefCell<Engine> = RefCell::new(Engine::default());
    static HEALTH_FLAG: RefCell<Option<Arc<AtomicU8>>> = const { RefCell::new(None) };
    static FOREGROUND: Cell<(isize,bool)> = const { Cell::new((0,false)) };
    static OWN_ELEVATED: Cell<bool> = const { Cell::new(false) };
}
fn inject(scan: u16, down: bool) -> bool {
    let mut flags = KEYEVENTF_SCANCODE;
    if scan & 0xe000 != 0 {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    if !down {
        flags |= KEYEVENTF_KEYUP;
    }
    let input = INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wScan: scan & 0xff,
                dwFlags: flags,
                dwExtraInfo: MARKER,
                ..Default::default()
            },
        },
    };
    unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) == 1 }
}
fn failed() {
    HEALTH_FLAG.with(|flag| {
        if let Some(flag) = flag.borrow().as_ref() {
            if flag.swap(1, Ordering::AcqRel) == 0 {
                unsafe {
                    let _ = PostThreadMessageW(GetCurrentThreadId(), HEALTH, WPARAM(0), LPARAM(0));
                }
            }
        }
    });
}
// Process/token inspection runs on the message loop, never inside the keyboard callback.
unsafe fn elevated(process: HANDLE) -> Result<bool, String> {
    let mut token = HANDLE::default();
    OpenProcessToken(process, TOKEN_QUERY, &mut token).map_err(|error| error.to_string())?;
    let mut value = TOKEN_ELEVATION::default();
    let mut length = 0;
    let result = GetTokenInformation(
        token,
        TokenElevation,
        Some(&mut value as *mut _ as *mut _),
        std::mem::size_of::<TOKEN_ELEVATION>() as u32,
        &mut length,
    );
    let _ = CloseHandle(token);
    result.map_err(|error| error.to_string())?;
    Ok(value.TokenIsElevated != 0)
}
unsafe fn refresh_access(own_elevated: bool) {
    let window = GetForegroundWindow();
    let previously_allowed = FOREGROUND.with(|cache| cache.get().1);
    if FOREGROUND.with(|cache| cache.get().0 == window.0 as isize) {
        return;
    }
    let mut pid = 0;
    GetWindowThreadProcessId(window, Some(&mut pid));
    let allowed = if pid == std::process::id() {
        true
    } else {
        OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
            .ok()
            .is_some_and(|process| {
                let result = elevated(process).is_ok_and(|other| own_elevated || !other);
                let _ = CloseHandle(process);
                result
            })
    };
    FOREGROUND.with(|cache| cache.set((window.0 as isize, allowed)));
    if allowed && !previously_allowed {
        ENGINE.with(|engine| {
            let mut engine = engine.borrow_mut();
            if engine.release_all(inject).is_ok() {
                engine.faulted = false;
                HEALTH_FLAG.with(|flag| {
                    if let Some(flag) = flag.borrow().as_ref() {
                        flag.store(0, Ordering::Release);
                    }
                });
            }
        });
    }
    if !allowed && !window.is_invalid() {
        ENGINE.with(|engine| {
            let mut engine = engine.borrow_mut();
            if !engine.rules.is_empty() {
                let _ = engine.release_all(inject);
                engine.faulted = true;
                failed();
            }
        });
    }
}
unsafe extern "system" fn foreground_changed(
    _: HWINEVENTHOOK,
    _: u32,
    _: HWND,
    _: i32,
    _: i32,
    _: u32,
    _: u32,
) {
    if std::panic::catch_unwind(|| refresh_access(OWN_ELEVATED.with(Cell::get))).is_err() {
        failed();
    }
}
unsafe extern "system" fn hook(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
    if code < 0 {
        return CallNextHookEx(None, code, w, l);
    }
    let event = &*(l.0 as *const KBDLLHOOKSTRUCT);
    if ignore_injected(event.flags, event.dwExtraInfo) {
        return CallNextHookEx(None, code, w, l);
    }
    let down = match w.0 as u32 {
        WM_KEYDOWN | WM_SYSKEYDOWN => true,
        WM_KEYUP | WM_SYSKEYUP => false,
        _ => return CallNextHookEx(None, code, w, l),
    };
    let scan = event.scanCode as u16
        | if event.flags.contains(LLKHF_EXTENDED) {
            0xe000
        } else {
            0
        };
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        ENGINE.with(|engine| {
            let mut engine = engine.borrow_mut();
            let window = GetForegroundWindow().0 as isize;
            let (known, allowed) = FOREGROUND.with(Cell::get);
            if window != known || !allowed {
                if window != known {
                    let _ = PostThreadMessageW(GetCurrentThreadId(), ACCESS, WPARAM(0), LPARAM(0));
                }
                engine.bypass(scan, down, inject);
                return false;
            }
            let result = engine.input(scan, down, inject);
            if engine.faulted {
                failed();
            }
            result
        })
    }));
    match outcome {
        Ok(true) => LRESULT(1),
        Err(_) => {
            failed();
            CallNextHookEx(None, code, w, l)
        }
        _ => CallNextHookEx(None, code, w, l),
    }
}
struct Update {
    rules: Rules,
    ticket: Arc<AtomicU8>,
    reply: mpsc::SyncSender<Result<(), String>>,
}
fn ignore_injected(flags: KBDLLHOOKSTRUCT_FLAGS, marker: usize) -> bool {
    flags.contains(LLKHF_INJECTED) || marker == MARKER
}
pub struct Worker {
    tid: u32,
    tx: mpsc::Sender<Update>,
    thread: Option<thread::JoinHandle<()>>,
}
impl Worker {
    pub fn start(app: AppHandle, health: Arc<AtomicU8>) -> Result<Self, String> {
        let (tx, rx) = mpsc::channel::<Update>();
        let (ready, wait) = mpsc::sync_channel(1);
        let handle = thread::Builder::new().name("key-mapping".into()).spawn(move || unsafe {
            let mut msg = MSG::default();
            let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
            HEALTH_FLAG.with(|slot| *slot.borrow_mut() = Some(health.clone()));
            let own_elevated=elevated(GetCurrentProcess()).unwrap_or(false);
            OWN_ELEVATED.with(|slot|slot.set(own_elevated));
            let foreground_hook=SetWinEventHook(EVENT_SYSTEM_FOREGROUND,EVENT_SYSTEM_FOREGROUND,None,Some(foreground_changed),0,0,WINEVENT_OUTOFCONTEXT);
            if foreground_hook.is_invalid() { tracing::warn!("Foreground permission event subscription unavailable; using message-loop checks"); }
            refresh_access(own_elevated);
            let timer=SetTimer(None,0,100,None);
            if ready.send(GetCurrentThreadId()).is_err() { return; }
            let mut installed: Option<HHOOK> = None;
            loop {
                let result = GetMessageW(&mut msg, None, 0, 0).0;
                if result <= 0 { break; }
                if msg.message == UPDATE {
                    while let Ok(update) = rx.try_recv() {
                        if update.ticket.compare_exchange(0,1,Ordering::AcqRel,Ordering::Acquire).is_err() { continue; }
                        let result = ENGINE.with(|engine| -> Result<(),String> {
                            let mut engine = engine.borrow_mut();
                            engine.release_all(inject)?;
                            if !update.rules.is_empty() && installed.is_none() {
                                let module = GetModuleHandleW(None).map_err(|e| e.to_string())?;
                                installed = Some(SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook), Some(HINSTANCE(module.0)), 0).map_err(|e| format!("安装键盘映射钩子失败：{e}"))?);
                                for key in crate::supported_keys() {
                                    if let Some(scan)=crate::scancode_mapper::scan_code(key.code).filter(|scan|scan.0 != 0) {
                                        let virtual_key=MapVirtualKeyW(scan.0 as u32,MAPVK_VSC_TO_VK_EX);
                                        if virtual_key != 0 && GetAsyncKeyState(virtual_key as i32) < 0 { engine.observe_pressed(scan.0); }
                                    }
                                }
                            }
                            if update.rules.is_empty() {
                                if let Some(hook) = installed { UnhookWindowsHookEx(hook).map_err(|e| e.to_string())?; installed=None; }
                                engine.reset_unhooked();
                            }
                            engine.rules = update.rules;
                            engine.faulted = false;
                            Ok(())
                        });
                        health.store(if result.is_ok() { 0 } else { 1 }, Ordering::Release);
                        // Recheck even if the foreground handle has not changed since a failed attempt.
                        FOREGROUND.with(|cache|cache.set((0,false)));
                        refresh_access(own_elevated);
                        let _ = update.reply.send(result);
                    }
                } else if msg.message == HEALTH {
                    if health.load(Ordering::Acquire) == 0 { continue; }
                    ENGINE.with(|engine| { let mut engine=engine.borrow_mut(); let _=engine.release_all(inject); engine.faulted=true; });
                    tracing::warn!(target:"dock_mapper::key_mapping", "Runtime key mapping paused: injection unavailable in current window");
                    if let Err(error)=app.emit("key-mapping-changed", ()) { tracing::warn!(%error); }
                    if let Err(error)=app.emit("key-mapping-error", "按键映射已暂停：当前窗口权限较高或输入注入失败。切回普通权限窗口可恢复；仍失败时请在按键映射页重试运行。") { tracing::warn!(%error); }
                } else if msg.message == ACCESS || msg.message == WM_TIMER { refresh_access(own_elevated); }
                else { let _=TranslateMessage(&msg); DispatchMessageW(&msg); }
            }
            let _=KillTimer(None,timer);
            if !foreground_hook.is_invalid() { let _=UnhookWinEvent(foreground_hook); }
            ENGINE.with(|engine| { if let Err(error) = engine.borrow_mut().release_all(inject) { tracing::error!(target:"dock_mapper::key_mapping", %error, "Failed to release mapping keys on exit"); } });
            if let Some(hook) = installed { let _ = UnhookWindowsHookEx(hook); }
            health.store(1,Ordering::Release);
        }).map_err(|e| e.to_string())?;
        let tid = wait.recv().map_err(|_| "键盘映射线程启动失败")?;
        Ok(Self {
            tid,
            tx,
            thread: Some(handle),
        })
    }
    pub fn configure(&self, rules: Rules) -> Result<(), String> {
        let (reply, result) = mpsc::sync_channel(1);
        let ticket = Arc::new(AtomicU8::new(0));
        self.tx
            .send(Update {
                rules,
                reply,
                ticket: ticket.clone(),
            })
            .map_err(|_| "键盘映射线程已停止")?;
        unsafe {
            if let Err(error) = PostThreadMessageW(self.tid, UPDATE, WPARAM(0), LPARAM(0)) {
                if ticket
                    .compare_exchange(0, 2, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
                {
                    return Err(error.to_string());
                }
            }
        }
        result.recv().map_err(|_| "键盘映射线程未返回结果")?
    }
    pub fn alive(&self) -> bool {
        self.thread
            .as_ref()
            .is_some_and(|thread| !thread.is_finished())
    }
}
impl Drop for Worker {
    fn drop(&mut self) {
        if let Err(error) = self.configure(Rules::new()) {
            tracing::error!(%error,"Failed to stop mapping before exit");
        }
        unsafe {
            let _ = PostThreadMessageW(self.tid, WM_QUIT, WPARAM(0), LPARAM(0));
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn injected_keys_cannot_enter_a_mapping_chain_or_cycle() {
        assert!(ignore_injected(LLKHF_INJECTED, 0));
        assert!(ignore_injected(LLKHF_EXTENDED, MARKER));
        assert!(!ignore_injected(LLKHF_EXTENDED, 0));
    }
}
