use super::*;
use std::sync::atomic::AtomicBool;
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

static BUSY: AtomicBool = AtomicBool::new(false);
struct QueryGuard;
impl Drop for QueryGuard {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::SeqCst);
        unsafe {
            CoUninitialize();
        }
    }
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
    if BUSY.swap(true, Ordering::SeqCst) {
        return Ok(vec![candidate]);
    }
    let fallback = candidate.clone();
    let task = tokio::task::spawn_blocking(
        move || -> Result<Vec<window_candidates::WindowCandidate>, String> {
            unsafe {
                if let Err(error) = CoInitializeEx(None, COINIT_MULTITHREADED).ok() {
                    BUSY.store(false, Ordering::SeqCst);
                    return Err(error.to_string());
                }
                let _guard = QueryGuard;
                let automation: IUIAutomation2 =
                    CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER)
                        .map_err(|e| e.to_string())?;
                automation
                    .SetConnectionTimeout(50)
                    .map_err(|e| e.to_string())?;
                automation
                    .SetTransactionTimeout(50)
                    .map_err(|e| e.to_string())?;
                let automation: IUIAutomation = automation.cast().map_err(|e| e.to_string())?;
                let mut parent = automation
                    .ElementFromHandle(HWND(candidate.native_handle as *mut _))
                    .map_err(|e| e.to_string())?;
                let walker = automation.ControlViewWalker().map_err(|e| e.to_string())?;
                let px = capture.physical_origin_x + (x * capture.scale_factor).round() as i32;
                let py = capture.physical_origin_y + (y * capture.scale_factor).round() as i32;
                let mut result = vec![candidate];
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
                            if px >= rect.left
                                && py >= rect.top
                                && px < rect.right
                                && py < rect.bottom
                            {
                                let scale = capture.scale_factor;
                                let left = rect.left.max(capture.physical_origin_x);
                                let top = rect.top.max(capture.physical_origin_y);
                                let right = rect
                                    .right
                                    .min(capture.physical_origin_x + capture.image_width as i32);
                                let bottom = rect
                                    .bottom
                                    .min(capture.physical_origin_y + capture.image_height as i32);
                                if right - left >= 8 && bottom - top >= 8 {
                                    result.push(window_candidates::WindowCandidate {
                                        id: format!("element-{generation}-{depth}"),
                                        x: (left - capture.physical_origin_x) as f64 / scale,
                                        y: (top - capture.physical_origin_y) as f64 / scale,
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
        },
    );
    let result = tokio::time::timeout(std::time::Duration::from_millis(250), task).await;
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
