use super::*;
use std::io::Write;
use std::os::windows::ffi::OsStrExt;
use windows::{
    core::PCWSTR,
    Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_WRITE_THROUGH},
};

static RESTORE_ERROR: Mutex<Option<String>> = Mutex::new(None);
pub(super) fn record_restore_error(app: &AppHandle, error: String) {
    *RESTORE_ERROR.lock_or_recover() = Some(error.clone());
    if let Err(error) = app.emit("pin-restore-failed", error) {
        tracing::warn!(%error, "贴图恢复错误通知失败");
    }
}
#[tauri::command]
pub fn get_pin_restore_error() -> Option<String> {
    RESTORE_ERROR.lock_or_recover().clone()
}

static RESTORING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
struct RestoreGuard;
impl RestoreGuard {
    fn acquire() -> Result<Self, String> {
        RESTORING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "正在恢复贴图，请稍候".to_string())?;
        Ok(Self)
    }
}
impl Drop for RestoreGuard {
    fn drop(&mut self) {
        RESTORING.store(false, Ordering::SeqCst);
    }
}

static DISK_LOCK: Mutex<()> = Mutex::new(());
static REVISION: AtomicU64 = AtomicU64::new(0);
static SAVE_ORDER: AtomicU64 = AtomicU64::new(0);
static APPLIED_ORDER: AtomicU64 = AtomicU64::new(0);
static WRITER_RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[derive(Clone, Deserialize, Serialize)]
struct Entry {
    id: String,
    closed: bool,
    options: PinOptions,
    geometry: PinWindowGeometry,
    base_width: u32,
    base_height: u32,
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("pins");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}
fn read(root: &std::path::Path) -> Result<Vec<Entry>, String> {
    match fs::read(root.join("manifest.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("贴图记录损坏：{e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.to_string()),
    }
}
fn write(root: &std::path::Path, entries: &[Entry]) -> Result<(), String> {
    let target = root.join("manifest.json");
    let temporary = root.join("manifest.pending");
    let bytes = serde_json::to_vec(entries).map_err(|e| e.to_string())?;
    let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    drop(file);
    if target.exists() {
        let wide = |p: &std::path::Path| {
            p.as_os_str()
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>()
        };
        let target = wide(&target);
        let temporary = wide(&temporary);
        unsafe {
            ReplaceFileW(
                PCWSTR(target.as_ptr()),
                PCWSTR(temporary.as_ptr()),
                PCWSTR::null(),
                REPLACEFILE_WRITE_THROUGH,
                None,
                None,
            )
        }
        .map_err(|e| e.to_string())
    } else {
        fs::rename(temporary, target).map_err(|e| e.to_string())
    }
}

pub(super) fn is_restoring() -> bool {
    RESTORING.load(Ordering::SeqCst)
}

pub(super) fn save(app: &AppHandle, closing: Option<&str>) -> Result<(), String> {
    if RESTORING.load(Ordering::SeqCst) {
        if closing.is_some() {
            return Err("正在恢复贴图，请稍后关闭".into());
        }
        return Ok(());
    }
    let order = SAVE_ORDER.fetch_add(1, Ordering::SeqCst) + 1;
    let ids = app
        .state::<AppState>()
        .pin_runtime
        .lock_or_recover()
        .order
        .clone();
    let mut snapshots = Vec::new();
    // Query native windows before taking the disk lock: background writers must
    // never hold that lock while waiting for the main event loop during exit.
    for id in ids {
        let geometry = match get_pin_window_geometry(app.clone(), id.clone()) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let state = app.state::<AppState>();
        let runtime = state.pin_runtime.lock_or_recover();
        if let (Some(data), Some(options), Some(base)) = (
            runtime.data.get(&id),
            runtime.options.get(&id),
            runtime.geometries.get(&id),
        ) {
            snapshots.push((id, geometry, *options, *base, Arc::clone(data)));
        }
    }
    let _disk = DISK_LOCK.lock_or_recover();
    let outdated = order < APPLIED_ORDER.load(Ordering::SeqCst);
    if outdated && closing.is_none() {
        return Ok(());
    }
    if RESTORING.load(Ordering::SeqCst) {
        if closing.is_some() {
            return Err("正在恢复贴图，请稍后关闭".into());
        }
        return Ok(());
    }
    let root = root(app)?;
    let mut entries = read(&root)?;
    let saved_options: Vec<_> = snapshots
        .iter()
        .map(|(id, _, options, _, _)| (id.clone(), *options))
        .collect();
    let before = entries
        .iter()
        .filter(|entry| entry.closed)
        .map(|entry| entry.id.clone())
        .collect::<Vec<_>>();
    for (id, geometry, options, base, data) in snapshots {
        if outdated {
            continue;
        }
        let path = root.join(format!("{id}.png"));
        if !path.exists() {
            let temporary = path.with_extension("png.pending");
            let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
            file.write_all(data.as_ref())
                .and_then(|_| file.sync_all())
                .map_err(|e| e.to_string())?;
            drop(file);
            fs::rename(temporary, &path).map_err(|e| e.to_string())?;
        }
        let was_closed = entries.iter().any(|entry| entry.id == id && entry.closed);
        let entry = Entry {
            id: id.clone(),
            closed: was_closed || closing == Some(id.as_str()),
            options,
            geometry,
            base_width: base.base_width,
            base_height: base.base_height,
        };
        if let Some(existing) = entries.iter_mut().find(|e| e.id == id) {
            *existing = entry;
        } else {
            entries.push(entry);
        }
    }
    if let Some(id) = closing {
        if let Some(index) = entries.iter().position(|entry| entry.id == id) {
            let mut closed = entries.remove(index);
            closed.closed = true;
            entries.push(closed);
        }
    }
    let limit = app
        .state::<crate::AppState>()
        .config
        .lock_or_recover()
        .screenshot_config
        .experience
        .pin_history_limit
        .min(100);
    retain_recent_closed(&mut entries, limit);
    write(&root, &entries)?;
    APPLIED_ORDER.fetch_max(order, Ordering::SeqCst);
    for (id, options) in saved_options {
        if let Err(error) = app.emit_to(
            &id,
            "pin-options-saved",
            serde_json::json!({ "id": id, "options": options }),
        ) {
            tracing::warn!(%error, "贴图保存状态通知失败");
        }
    }
    for id in before.into_iter().chain(closing.map(str::to_owned)) {
        if entries.iter().any(|entry| entry.id == id) {
            continue;
        }
        remove_asset(app, &root, &id);
    }
    Ok(())
}

fn remove_asset(app: &AppHandle, root: &std::path::Path, id: &str) {
    if !id.starts_with("pin-") || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return;
    }
    if let Err(error) = fs::remove_file(root.join(format!("{id}.png"))) {
        if error.kind() != std::io::ErrorKind::NotFound {
            let _ = app.emit(
                "pin-persistence-error",
                format!("过期贴图文件清理失败：{error}"),
            );
        }
    }
}

fn retain_recent_closed(entries: &mut Vec<Entry>, limit: usize) {
    let mut remaining = limit;
    entries.reverse();
    entries.retain(|entry| {
        if !entry.closed {
            true
        } else if remaining > 0 {
            remaining -= 1;
            true
        } else {
            false
        }
    });
    entries.reverse();
}

pub(super) fn schedule(app: AppHandle) {
    REVISION.fetch_add(1, Ordering::SeqCst);
    if WRITER_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(move || loop {
        let revision = REVISION.load(Ordering::SeqCst);
        thread::sleep(std::time::Duration::from_millis(250));
        if revision != REVISION.load(Ordering::SeqCst) {
            continue;
        }
        if let Err(error) = save(&app, None) {
            let _ = app.emit(
                "pin-persistence-error",
                format!("贴图位置或设置未保存：{error}"),
            );
        }
        WRITER_RUNNING.store(false, Ordering::SeqCst);
        if revision != REVISION.load(Ordering::SeqCst) {
            schedule(app.clone());
        }
        return;
    });
}

fn restore_entry(app: &AppHandle, entry: Entry) -> Result<String, String> {
    if !entry.id.starts_with("pin-")
        || !entry
            .id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("贴图记录标识无效".into());
    }
    let root = root(app)?;
    let bytes = fs::read(root.join(format!("{}.png", entry.id))).map_err(|e| e.to_string())?;
    let id = pin_image_impl(app.clone(), bytes.into(), false)?;
    {
        let state = app.state::<AppState>();
        let mut runtime = state.pin_runtime.lock_or_recover();
        runtime.geometries.insert(
            id.clone(),
            PinGeometryRuntime {
                base_width: entry.base_width,
                base_height: entry.base_height,
                sequence: 0,
            },
        );
    }
    let restored = (|| {
        let geometry = set_pin_window_geometry(
            app.clone(),
            id.clone(),
            PinWindowGeometryRequest {
                x: entry.geometry.x as f64,
                y: entry.geometry.y as f64,
                width: entry.geometry.width as f64,
                height: entry.geometry.height as f64,
                scale: entry.geometry.scale,
                sequence: 1,
            },
        )?;
        app.state::<AppState>()
            .pin_runtime
            .lock_or_recover()
            .options
            .insert(id.clone(), entry.options);
        let data = app
            .state::<AppState>()
            .pin_runtime
            .lock_or_recover()
            .data
            .get(&id)
            .cloned()
            .ok_or("恢复图片不可用")?;
        let _disk = DISK_LOCK.lock_or_recover();
        let mut entries = read(&root)?;
        let temporary = root.join(format!("{id}.png.pending"));
        let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(data.as_ref())
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temporary, root.join(format!("{id}.png"))).map_err(|e| e.to_string())?;
        entries.retain(|e| e.id != entry.id);
        entries.push(Entry {
            id: id.clone(),
            closed: false,
            options: entry.options,
            geometry,
            base_width: entry.base_width,
            base_height: entry.base_height,
        });
        write(&root, &entries)?;
        APPLIED_ORDER.fetch_max(
            SAVE_ORDER.fetch_add(1, Ordering::SeqCst) + 1,
            Ordering::SeqCst,
        );
        remove_asset(app, &root, &entry.id);
        Ok::<(), String>(())
    })();
    if let Err(error) = restored {
        release_pin_runtime(app, &id, true);
        remove_asset(app, &root, &id);
        return Err(error);
    }
    if let Err(error) = app.emit_to(
        &id,
        "pin-options-changed",
        serde_json::json!({ "id": id, "options": entry.options }),
    ) {
        tracing::warn!(%error, "恢复贴图设置通知失败");
    }
    Ok(id)
}

#[tauri::command]
pub async fn restore_closed_pin(app: AppHandle) -> Result<String, String> {
    let guard = RestoreGuard::acquire()?;
    let result = (|| {
        let entries = read(&root(&app)?)?;
        let entry = entries
            .into_iter()
            .rev()
            .find(|e| e.closed)
            .ok_or("没有可恢复的已关闭贴图")?;
        restore_entry(&app, entry)
    })();
    drop(guard);
    schedule(app.clone());
    result
}

fn restore_each<T>(
    items: impl IntoIterator<Item = T>,
    mut restore: impl FnMut(T) -> Result<(), String>,
) -> Vec<String> {
    items
        .into_iter()
        .filter_map(|item| restore(item).err())
        .collect()
}

pub(super) fn restore_open(app: &AppHandle) -> Result<(), String> {
    if !app
        .state::<crate::AppState>()
        .config
        .lock_or_recover()
        .screenshot_config
        .experience
        .restore_pins
    {
        return Ok(());
    }
    let guard = RestoreGuard::acquire()?;
    let entries = read(&root(app)?)?;
    let current_ids: HashSet<_> = app
        .state::<AppState>()
        .pin_runtime
        .lock_or_recover()
        .data
        .keys()
        .cloned()
        .collect();
    let failures = restore_each(
        entries
            .into_iter()
            .filter(|e| !e.closed && !current_ids.contains(&e.id)),
        |entry| {
            let previous_id = entry.id.clone();
            restore_entry(app, entry)
                .map(|_| ())
                .map_err(|error| format!("{previous_id}：{error}"))
        },
    );
    drop(guard);
    schedule(app.clone());
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "部分贴图未恢复，其余贴图已继续恢复；失败记录已保留：{}",
            failures.join("；")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_damaged_pin_does_not_prevent_later_pins_from_restoring() {
        let mut attempted = Vec::new();
        let failures = restore_each(["good", "damaged", "later"], |id| {
            attempted.push(id);
            if id == "damaged" {
                Err("damaged.png 不可读".into())
            } else {
                Ok(())
            }
        });
        assert_eq!(attempted, vec!["good", "damaged", "later"]);
        assert_eq!(failures, vec!["damaged.png 不可读"]);
    }
    fn entry(id: &str, closed: bool) -> Entry {
        Entry {
            id: id.into(),
            closed,
            options: PinOptions {
                opacity: 0.6,
                locked: true,
            },
            geometry: PinWindowGeometry {
                x: -500,
                y: 90,
                width: 400,
                height: 200,
                scale: 2.0,
                sequence: 4,
            },
            base_width: 200,
            base_height: 100,
        }
    }
    #[test]
    fn reopening_a_saved_pin_preserves_position_zoom_opacity_and_lock() {
        let saved = serde_json::to_vec(&entry("pin-1", false)).unwrap();
        let restored: Entry = serde_json::from_slice(&saved).unwrap();
        assert_eq!(restored.geometry.x, -500);
        assert_eq!(restored.geometry.scale, 2.0);
        assert_eq!(restored.options.opacity, 0.6);
        assert!(restored.options.locked);
    }
    #[test]
    fn history_limit_keeps_open_pins_and_the_most_recent_closed_pin() {
        let mut entries = vec![
            entry("pin-old", true),
            entry("pin-open", false),
            entry("pin-recent", true),
        ];
        retain_recent_closed(&mut entries, 1);
        assert_eq!(
            entries.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            vec!["pin-open", "pin-recent"]
        );
        retain_recent_closed(&mut entries, 0);
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].closed);
    }
}
