use image::{ImageFormat, ImageOutputFormat};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{Cursor, Write},
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, AtomicUsize, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use windows::{
    core::PCWSTR,
    Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_WRITE_THROUGH},
};

const DEFAULT_MAX_UNFAVORITED: usize = 100;
const DEFAULT_MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const RESULT_FILE: &str = "result.png";
const THUMBNAIL_FILE: &str = "thumbnail.png";
const MANIFEST_FILE: &str = "manifest.json";
const THUMBNAIL_MAX_WIDTH: u32 = 480;
const THUMBNAIL_MAX_HEIGHT: u32 = 300;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ScreenshotHistorySummary {
    pub id: String,
    pub created_at_ms: u64,
    pub width: u32,
    pub height: u32,
    pub favorite: bool,
    pub total_bytes: u64,
}

pub struct HistoryStore {
    root: PathBuf,
    generation: AtomicU64,
    count: AtomicUsize,
    max_unfavorited: usize,
    max_age: Duration,
}

impl HistoryStore {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        let store = Self {
            root,
            generation: AtomicU64::new(0),
            count: AtomicUsize::new(0),
            max_unfavorited: DEFAULT_MAX_UNFAVORITED,
            max_age: DEFAULT_MAX_AGE,
        };
        fs::create_dir_all(&store.root)
            .map_err(|error| format!("创建截图历史目录失败：{error}"))?;
        store.remove_abandoned_temporary_entries();
        store
            .count
            .store(store.read_manifests()?.len(), Ordering::Release);
        store.cleanup()?;
        Ok(store)
    }

    pub fn create(&self, result: &[u8]) -> Result<ScreenshotHistorySummary, String> {
        let (width, height) = png_dimensions(result)?;
        let thumbnail = match create_thumbnail(result) {
            Ok(thumbnail) => Some(thumbnail),
            Err(error) => {
                tracing::warn!(target: "dock_mapper::history", %error, "生成截图历史缩略图失败");
                None
            }
        };

        let created_at_ms = now_ms();
        let id = self.next_id(created_at_ms)?;
        let final_dir = self.entry_path(&id)?;
        let temporary_dir = self.root.join(format!(".tmp-{id}"));
        fs::create_dir(&temporary_dir)
            .map_err(|error| format!("创建截图历史临时目录失败：{error}"))?;

        let result = (|| {
            write_synced(&temporary_dir.join(RESULT_FILE), result)?;
            if let Some(thumbnail) = thumbnail.as_deref() {
                if let Err(error) = write_synced(&temporary_dir.join(THUMBNAIL_FILE), thumbnail) {
                    tracing::warn!(target: "dock_mapper::history", %error, "写入截图历史缩略图失败");
                }
            }
            let summary = ScreenshotHistorySummary {
                id: id.clone(),
                created_at_ms,
                width,
                height,
                favorite: false,
                total_bytes: result.len() as u64,
            };
            write_manifest(&temporary_dir.join(MANIFEST_FILE), &summary, false)?;
            fs::rename(&temporary_dir, &final_dir)
                .map_err(|error| format!("提交截图历史失败：{error}"))?;
            self.count.fetch_add(1, Ordering::AcqRel);
            Ok(summary)
        })();

        if result.is_err() {
            let _ = fs::remove_dir_all(&temporary_dir);
        } else if let Err(error) = self.cleanup() {
            tracing::warn!(target: "dock_mapper::history", %error, "截图历史自动清理失败");
        }
        result
    }

    pub fn list(&self) -> Result<Vec<ScreenshotHistorySummary>, String> {
        let mut entries = self.read_manifests()?;
        self.count.store(entries.len(), Ordering::Release);
        entries.sort_by(|left, right| right.created_at_ms.cmp(&left.created_at_ms));
        Ok(entries)
    }

    pub fn count(&self) -> usize {
        self.count.load(Ordering::Acquire)
    }

    pub fn image(&self, id: &str) -> Result<Vec<u8>, String> {
        fs::read(self.entry_path(id)?.join(RESULT_FILE))
            .map_err(|error| format!("读取截图历史图片失败：{error}"))
    }

    pub fn thumbnail(&self, id: &str) -> Result<Vec<u8>, String> {
        let entry_path = self.entry_path(id)?;
        let thumbnail_path = entry_path.join(THUMBNAIL_FILE);
        if let Ok(thumbnail) = fs::read(&thumbnail_path) {
            if !thumbnail.is_empty() && png_dimensions(&thumbnail).is_ok() {
                return Ok(thumbnail);
            }
        }

        let image = fs::read(entry_path.join(RESULT_FILE))
            .map_err(|error| format!("读取截图历史图片失败：{error}"))?;
        let thumbnail = create_thumbnail(&image)?;
        if let Err(error) = self.write_thumbnail_cache(&thumbnail_path, &thumbnail) {
            tracing::warn!(target: "dock_mapper::history", %id, %error, "缓存截图历史缩略图失败");
        }
        Ok(thumbnail)
    }

    pub fn set_favorite(
        &self,
        id: &str,
        favorite: bool,
    ) -> Result<ScreenshotHistorySummary, String> {
        let path = self.entry_path(id)?;
        let manifest_path = path.join(MANIFEST_FILE);
        let mut summary = read_manifest(&manifest_path)?;
        summary.favorite = favorite;
        write_manifest(&manifest_path, &summary, true)?;
        Ok(summary)
    }

    pub fn delete(&self, id: &str) -> Result<bool, String> {
        let path = self.entry_path(id)?;
        if !path.exists() {
            return Ok(false);
        }
        fs::remove_dir_all(path).map_err(|error| format!("删除截图历史失败：{error}"))?;
        let _ = self
            .count
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                Some(count.saturating_sub(1))
            });
        Ok(true)
    }

    pub fn cleanup(&self) -> Result<(), String> {
        let cutoff = now_ms().saturating_sub(self.max_age.as_millis() as u64);
        let mut unfavorited = self
            .read_manifests()?
            .into_iter()
            .filter(|entry| !entry.favorite)
            .collect::<Vec<_>>();
        unfavorited.sort_by_key(|entry| entry.created_at_ms);

        for entry in unfavorited
            .iter()
            .filter(|entry| entry.created_at_ms < cutoff)
        {
            self.delete(&entry.id)?;
        }
        unfavorited.retain(|entry| entry.created_at_ms >= cutoff);
        let excess = unfavorited.len().saturating_sub(self.max_unfavorited);
        for entry in unfavorited.into_iter().take(excess) {
            self.delete(&entry.id)?;
        }
        Ok(())
    }

    fn read_manifests(&self) -> Result<Vec<ScreenshotHistorySummary>, String> {
        let mut result = Vec::new();
        let directories =
            fs::read_dir(&self.root).map_err(|error| format!("读取截图历史目录失败：{error}"))?;
        for directory in directories.flatten() {
            let Some(id) = directory.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if !is_valid_id(&id) || !directory.path().is_dir() {
                continue;
            }
            match read_manifest(&directory.path().join(MANIFEST_FILE)) {
                Ok(summary) => match self.validate_entry(&directory.path(), &id, &summary) {
                    Ok(()) => result.push(summary),
                    Err(error) => {
                        tracing::warn!(target: "dock_mapper::history", %id, %error, "忽略损坏的截图历史记录")
                    }
                },
                Err(error) => {
                    tracing::warn!(target: "dock_mapper::history", %id, %error, "忽略损坏的截图历史记录")
                }
            }
        }
        Ok(result)
    }

    fn entry_path(&self, id: &str) -> Result<PathBuf, String> {
        if !is_valid_id(id) {
            return Err("截图历史 ID 无效".into());
        }
        Ok(self.root.join(id))
    }

    fn next_id(&self, created_at_ms: u64) -> Result<String, String> {
        for _ in 0..1024 {
            let id = format!(
                "history-{created_at_ms}-{}",
                self.generation.fetch_add(1, Ordering::Relaxed) + 1
            );
            if !self.root.join(&id).exists() && !self.root.join(format!(".tmp-{id}")).exists() {
                return Ok(id);
            }
        }
        Err("无法分配唯一的截图历史 ID".into())
    }

    fn validate_entry(
        &self,
        path: &Path,
        directory_id: &str,
        summary: &ScreenshotHistorySummary,
    ) -> Result<(), String> {
        if summary.id != directory_id {
            return Err("截图历史目录与清单 ID 不一致".into());
        }
        if summary.width == 0 || summary.height == 0 {
            return Err("截图历史图片尺寸无效".into());
        }
        let metadata = fs::metadata(path.join(RESULT_FILE))
            .map_err(|error| format!("读取截图历史导出图信息失败：{error}"))?;
        if !metadata.is_file() || metadata.len() == 0 {
            return Err("截图历史导出图为空".into());
        }
        Ok(())
    }

    fn write_thumbnail_cache(&self, path: &Path, thumbnail: &[u8]) -> Result<(), String> {
        let temporary = path.with_extension(format!(
            "png.{}.tmp",
            self.generation.fetch_add(1, Ordering::Relaxed) + 1
        ));
        write_synced(&temporary, thumbnail)?;
        let result = if path.exists() {
            replace_file(path, &temporary)
        } else {
            fs::rename(&temporary, path)
                .map_err(|error| format!("提交截图历史缩略图失败：{error}"))
        };
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }

    fn remove_abandoned_temporary_entries(&self) {
        let Ok(entries) = fs::read_dir(&self.root) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            if name.to_string_lossy().starts_with(".tmp-history-") && entry.path().is_dir() {
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }

    #[cfg(test)]
    fn with_limits(
        root: PathBuf,
        max_unfavorited: usize,
        max_age: Duration,
    ) -> Result<Self, String> {
        let mut store = Self::new(root)?;
        store.max_unfavorited = max_unfavorited;
        store.max_age = max_age;
        Ok(store)
    }
}

fn png_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    let reader = image::io::Reader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| format!("读取截图历史图片失败：{error}"))?;
    if reader.format() != Some(ImageFormat::Png) {
        return Err("截图历史图片不是 PNG".into());
    }
    reader
        .into_dimensions()
        .map_err(|error| format!("截图历史图片不是有效 PNG：{error}"))
}

fn create_thumbnail(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let image = image::load_from_memory_with_format(bytes, ImageFormat::Png)
        .map_err(|error| format!("解码截图历史缩略图失败：{error}"))?;
    let thumbnail = if image.width() <= THUMBNAIL_MAX_WIDTH
        && image.height() <= THUMBNAIL_MAX_HEIGHT
    {
        image
    } else {
        image.thumbnail(THUMBNAIL_MAX_WIDTH, THUMBNAIL_MAX_HEIGHT)
    };
    let mut output = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut output, ImageOutputFormat::Png)
        .map_err(|error| format!("编码截图历史缩略图失败：{error}"))?;
    Ok(output.into_inner())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn is_valid_id(id: &str) -> bool {
    id.strip_prefix("history-").is_some_and(|suffix| {
        !suffix.is_empty()
            && suffix
                .chars()
                .all(|character| character.is_ascii_digit() || character == '-')
    })
}

fn read_manifest(path: &Path) -> Result<ScreenshotHistorySummary, String> {
    let bytes = fs::read(path).map_err(|error| format!("读取截图历史清单失败：{error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("解析截图历史清单失败：{error}"))
}

fn write_manifest(
    path: &Path,
    summary: &ScreenshotHistorySummary,
    replace: bool,
) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(summary)
        .map_err(|error| format!("序列化截图历史清单失败：{error}"))?;
    if !replace {
        return write_synced(path, &bytes);
    }
    let temporary = path.with_extension("json.tmp");
    write_synced(&temporary, &bytes)?;
    replace_file(path, &temporary)
}

fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("创建截图历史文件失败：{error}"))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("写入截图历史文件失败：{error}"))
}

fn replace_file(path: &Path, replacement: &Path) -> Result<(), String> {
    let path_wide = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replacement_wide = replacement
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    unsafe {
        ReplaceFileW(
            PCWSTR(path_wide.as_ptr()),
            PCWSTR(replacement_wide.as_ptr()),
            PCWSTR::null(),
            REPLACEFILE_WRITE_THROUGH,
            None,
            None,
        )
    }
    .map_err(|error| format!("更新截图历史清单失败：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn temporary_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("dock-mapper-history-{name}-{}", now_ms()))
    }

    fn png_with_size(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(width, height)
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    fn png() -> Vec<u8> {
        png_with_size(2, 3)
    }

    #[test]
    fn creates_and_reads_a_final_image_entry() {
        let root = temporary_root("roundtrip");
        let store = HistoryStore::new(root.clone()).unwrap();
        let image = png();
        let created = store.create(&image).unwrap();
        assert_eq!((created.width, created.height), (2, 3));
        assert_eq!(created.total_bytes, image.len() as u64);
        assert_eq!(store.list().unwrap().len(), 1);
        assert_eq!(store.count(), 1);
        assert_eq!(store.image(&created.id).unwrap(), image);
        assert_eq!(png_dimensions(&store.thumbnail(&created.id).unwrap()).unwrap(), (2, 3));
        let entry = root.join(&created.id);
        assert!(entry.join(THUMBNAIL_FILE).exists());
        assert!(!entry.join("source.png").exists());
        assert!(!entry.join("scene.json").exists());
        assert_eq!(
            read_manifest(&entry.join(MANIFEST_FILE)).unwrap().id,
            created.id
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cached_count_does_not_read_the_history_directory() {
        let root = temporary_root("cached-count");
        let moved = root.with_extension("moved");
        let store = HistoryStore::new(root.clone()).unwrap();
        store.create(&png()).unwrap();
        assert_eq!(store.count(), 1);
        fs::rename(&root, &moved).unwrap();
        assert_eq!(store.count(), 1);
        assert!(store.list().is_err());
        let _ = fs::remove_dir_all(moved);
    }

    #[test]
    fn rejects_a_manifest_with_unknown_fields() {
        let root = temporary_root("unknown-field");
        let store = HistoryStore::new(root.clone()).unwrap();
        let created = store.create(&png()).unwrap();
        let manifest_path = root.join(created.id).join(MANIFEST_FILE);
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["obsolete"] = serde_json::json!(true);
        fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
        assert!(store.list().unwrap().is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_path_traversal_ids() {
        let root = temporary_root("traversal");
        let store = HistoryStore::new(root.clone()).unwrap();
        assert!(store.image("../config").is_err());
        assert!(store.thumbnail("../config").is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn list_does_not_decode_the_full_png() {
        let root = temporary_root("lightweight-list");
        let store = HistoryStore::new(root.clone()).unwrap();
        let created = store.create(&png()).unwrap();
        let entry = root.join(&created.id);
        fs::write(entry.join(RESULT_FILE), b"not-a-png").unwrap();
        fs::remove_file(entry.join(THUMBNAIL_FILE)).unwrap();

        assert_eq!(store.list().unwrap().len(), 1);
        assert!(store.thumbnail(&created.id).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_a_manifest_whose_id_differs_from_its_directory() {
        let root = temporary_root("mismatched-id");
        let store = HistoryStore::new(root.clone()).unwrap();
        let created = store.create(&png()).unwrap();
        let manifest_path = root.join(&created.id).join(MANIFEST_FILE);
        let mut summary = read_manifest(&manifest_path).unwrap();
        summary.id = "history-999-1".into();
        write_manifest(&manifest_path, &summary, true).unwrap();

        assert!(store.list().unwrap().is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn thumbnail_is_bounded_cached_and_regenerated_when_missing() {
        let root = temporary_root("thumbnail");
        let store = HistoryStore::new(root.clone()).unwrap();
        let created = store.create(&png_with_size(960, 900)).unwrap();
        let thumbnail_path = root.join(&created.id).join(THUMBNAIL_FILE);
        let first = store.thumbnail(&created.id).unwrap();
        let (width, height) = png_dimensions(&first).unwrap();
        assert!(width <= THUMBNAIL_MAX_WIDTH);
        assert!(height <= THUMBNAIL_MAX_HEIGHT);

        fs::remove_file(&thumbnail_path).unwrap();
        let regenerated = store.thumbnail(&created.id).unwrap();
        assert!(thumbnail_path.exists());
        assert_eq!(png_dimensions(&regenerated).unwrap(), (width, height));

        fs::write(root.join(&created.id).join(RESULT_FILE), b"broken").unwrap();
        assert_eq!(store.thumbnail(&created.id).unwrap(), regenerated);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_keeps_favorites_and_caps_unfavorited_entries() {
        let root = temporary_root("retention");
        let store = HistoryStore::with_limits(root.clone(), 2, DEFAULT_MAX_AGE).unwrap();
        let first = store.create(&png()).unwrap();
        store.set_favorite(&first.id, true).unwrap();
        store.create(&png()).unwrap();
        store.create(&png()).unwrap();
        store.create(&png()).unwrap();
        let entries = store.list().unwrap();
        assert_eq!(entries.iter().filter(|entry| !entry.favorite).count(), 2);
        assert!(entries
            .iter()
            .any(|entry| entry.id == first.id && entry.favorite));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_removes_expired_unfavorited_records_but_keeps_favorites() {
        let root = temporary_root("expiry");
        let store = HistoryStore::with_limits(root.clone(), 100, DEFAULT_MAX_AGE).unwrap();
        let expired = store.create(&png()).unwrap();
        let favorite = store.create(&png()).unwrap();
        store.set_favorite(&favorite.id, true).unwrap();

        let manifest_path = root.join(&expired.id).join(MANIFEST_FILE);
        let mut summary = read_manifest(&manifest_path).unwrap();
        summary.created_at_ms = now_ms() - DEFAULT_MAX_AGE.as_millis() as u64 - 1;
        write_manifest(&manifest_path, &summary, true).unwrap();

        store.cleanup().unwrap();
        let entries = store.list().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, favorite.id);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn favorite_update_replaces_a_complete_manifest() {
        let root = temporary_root("manifest");
        let store = HistoryStore::new(root.clone()).unwrap();
        let entry = store.create(&png()).unwrap();
        let updated = store.set_favorite(&entry.id, true).unwrap();
        assert!(updated.favorite);
        assert!(
            read_manifest(&root.join(&entry.id).join(MANIFEST_FILE))
                .unwrap()
                .favorite
        );
        assert!(!root.join(&entry.id).join("manifest.json.tmp").exists());
        let _ = fs::remove_dir_all(root);
    }
}
