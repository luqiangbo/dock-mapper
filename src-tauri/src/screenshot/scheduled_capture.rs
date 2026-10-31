use super::*;
use std::collections::HashMap;
static REQUEST: AtomicU64 = AtomicU64::new(0);
static REGIONS: LazyLock<Mutex<HashMap<u64, Rect>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
pub async fn schedule_screenshot(
    app: AppHandle,
    delay_ms: u64,
    cancel: bool,
    selection: Option<Rect>,
    screen_id: Option<u32>,
    physical: Option<bool>,
) -> Result<Option<u64>, String> {
    let request = REQUEST.fetch_add(1, Ordering::SeqCst) + 1;
    if cancel {
        return Ok(None);
    }
    if delay_ms > 60_000 {
        return Err("延时不能超过 60 秒".into());
    }
    if selection.is_some_and(|r| {
        !r.x.is_finite()
            || !r.y.is_finite()
            || !r.width.is_finite()
            || !r.height.is_finite()
            || r.width < 8.0
            || r.height < 8.0
    }) {
        return Err("预设区域无效".into());
    }
    tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
    if REQUEST.load(Ordering::SeqCst) != request {
        return Ok(None);
    }
    let generation =
        handle_start_capture_with_region(&app, selection, screen_id, physical.unwrap_or(false))?;
    Ok(Some(generation))
}
pub(super) fn selection(generation: u64) -> Option<Rect> {
    REGIONS.lock_or_recover().get(&generation).copied()
}

pub(super) fn remember(generation: u64, selection: Option<Rect>) {
    let mut regions = REGIONS.lock_or_recover();
    regions.clear();
    if let Some(rect) = selection {
        regions.insert(generation, rect);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preset_region_is_ready_before_capture_and_cannot_leak_into_a_new_session() {
        remember(
            91,
            Some(Rect {
                x: 120.0,
                y: 60.0,
                width: 300.0,
                height: 200.0,
            }),
        );
        assert_eq!(selection(91).unwrap().x, 120.0);
        assert!(selection(90).is_none());
        remember(92, None);
        assert!(selection(91).is_none());
        assert!(selection(92).is_none());
    }
}
