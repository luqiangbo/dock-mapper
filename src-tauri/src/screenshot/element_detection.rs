use super::*;
use std::sync::{mpsc, OnceLock};
use windows::{
    core::Interface,
    Win32::{
        Foundation::HWND,
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_MULTITHREADED,
        },
        UI::Accessibility::{CUIAutomation8, IUIAutomation, IUIAutomation2},
    },
};

struct ElementQuery {
    generation: u64,
    x: f64,
    y: f64,
    physical_origin_x: i32,
    physical_origin_y: i32,
    image_width: u32,
    image_height: u32,
    scale_factor: f64,
    candidate: window_candidates::WindowCandidate,
    reply: tokio::sync::oneshot::Sender<Result<Vec<window_candidates::WindowCandidate>, String>>,
}

struct ComGuard;
impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

fn create_automation() -> Result<IUIAutomation, String> {
    unsafe {
        let automation: IUIAutomation2 =
            CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| e.to_string())?;
        automation
            .SetConnectionTimeout(50)
            .map_err(|e| e.to_string())?;
        automation
            .SetTransactionTimeout(50)
            .map_err(|e| e.to_string())?;
        automation.cast().map_err(|e| e.to_string())
    }
}

fn run_query(
    automation: &IUIAutomation,
    query: &ElementQuery,
) -> Result<Vec<window_candidates::WindowCandidate>, String> {
    unsafe {
        let mut parent = automation
            .ElementFromHandle(HWND(query.candidate.native_handle as *mut _))
            .map_err(|e| e.to_string())?;
        let walker = automation.ControlViewWalker().map_err(|e| e.to_string())?;
        let px = query.physical_origin_x + (query.x * query.scale_factor).round() as i32;
        let py = query.physical_origin_y + (query.y * query.scale_factor).round() as i32;
        let mut result = vec![query.candidate.clone()];
        let started = Instant::now();
        let mut visited = 0;
        for depth in 0..16 {
            if started.elapsed().as_millis() > 180 {
                break;
            }
            let Ok(mut child) = walker.GetFirstChildElement(&parent) else {
                break;
            };
            let mut found = None;
            loop {
                visited += 1;
                if visited > 128 || started.elapsed().as_millis() > 180 {
                    break;
                }
                if let Ok(rect) = child.CurrentBoundingRectangle() {
                    if px >= rect.left && py >= rect.top && px < rect.right && py < rect.bottom {
                        let scale = query.scale_factor;
                        let left = rect.left.max(query.physical_origin_x);
                        let top = rect.top.max(query.physical_origin_y);
                        let right = rect
                            .right
                            .min(query.physical_origin_x + query.image_width as i32);
                        let bottom = rect
                            .bottom
                            .min(query.physical_origin_y + query.image_height as i32);
                        if right - left >= 8 && bottom - top >= 8 {
                            result.push(window_candidates::WindowCandidate {
                                id: format!("element-{}-{depth}", query.generation),
                                x: (left - query.physical_origin_x) as f64 / scale,
                                y: (top - query.physical_origin_y) as f64 / scale,
                                width: (right - left) as f64 / scale,
                                height: (bottom - top) as f64 / scale,
                                z_index: 0,
                                native_handle: 0,
                            });
                            found = Some(child);
                            break;
                        }
                    }
                }
                let Ok(next) = walker.GetNextSiblingElement(&child) else {
                    break;
                };
                child = next;
            }
            let Some(next) = found else {
                break;
            };
            parent = next;
        }
        result.reverse();
        Ok(result)
    }
}

fn worker_sender() -> &'static mpsc::SyncSender<ElementQuery> {
    static WORKER: OnceLock<mpsc::SyncSender<ElementQuery>> = OnceLock::new();
    WORKER.get_or_init(|| {
        // Capacity 1 keeps overlapping pointer moves from queuing stale UIA work.
        let (tx, rx) = mpsc::sync_channel::<ElementQuery>(1);
        let _ = thread::Builder::new()
            .name("dockmapper-uia-worker".into())
            .spawn(move || {
                let com_ready = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok() };
                if let Err(error) = com_ready {
                    let message = error.to_string();
                    while let Ok(query) = rx.recv() {
                        let _ = query.reply.send(Err(message.clone()));
                    }
                    return;
                }
                let _com_guard = ComGuard;
                let mut automation: Option<IUIAutomation> = None;
                while let Ok(query) = rx.recv() {
                    if automation.is_none() {
                        match create_automation() {
                            Ok(instance) => automation = Some(instance),
                            Err(error) => {
                                let _ = query.reply.send(Err(error));
                                continue;
                            }
                        }
                    }
                    let outcome = automation
                        .as_ref()
                        .map(|instance| run_query(instance, &query))
                        .unwrap_or_else(|| Err("UI Automation 实例不可用".into()));
                    if outcome.is_err() {
                        automation = None;
                    }
                    let _ = query.reply.send(outcome);
                }
            });
        tx
    })
}

#[tauri::command]
pub async fn query_capture_elements(
    app: AppHandle,
    generation: u64,
    x: f64,
    y: f64,
) -> Result<Vec<window_candidates::WindowCandidate>, String> {
    let capture = app
        .state::<AppState>()
        .capture
        .lock_or_recover()
        .clone()
        .filter(|c| c.generation == generation)
        .ok_or("截图会话已过期")?;
    if !x.is_finite() || !y.is_finite() {
        return Err("元素查询坐标无效".into());
    }
    let candidate = capture
        .window_candidates
        .iter()
        .filter(|c| x >= c.x && y >= c.y && x < c.x + c.width && y < c.y + c.height)
        .min_by_key(|c| c.z_index)
        .cloned();
    let Some(candidate) = candidate else {
        return Ok(Vec::new());
    };
    let fallback = candidate.clone();
    let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
    let query = ElementQuery {
        generation,
        x,
        y,
        physical_origin_x: capture.physical_origin_x,
        physical_origin_y: capture.physical_origin_y,
        image_width: capture.image_width,
        image_height: capture.image_height,
        scale_factor: capture.scale_factor,
        candidate,
        reply: reply_tx,
    };
    if worker_sender().try_send(query).is_err() {
        return Ok(vec![fallback]);
    }
    let result = tokio::time::timeout(std::time::Duration::from_millis(250), reply_rx).await;
    if app
        .state::<AppState>()
        .capture
        .lock_or_recover()
        .as_ref()
        .is_none_or(|c| c.generation != generation)
    {
        return Err("截图会话已过期".into());
    }
    Ok(match result {
        Ok(Ok(Ok(items))) => items,
        _ => vec![fallback],
    })
}
