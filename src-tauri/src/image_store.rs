use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

const MAX_ENTRIES: usize = 12;
const MAX_TOTAL_BYTES: usize = 96 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 64 * 1024 * 1024;
const ENTRY_TTL: Duration = Duration::from_secs(10 * 60);

struct StoredImage {
    bytes: Vec<u8>,
    created_at: Instant,
}

#[derive(Default)]
struct StoreInner {
    entries: HashMap<String, StoredImage>,
    order: VecDeque<String>,
    total_bytes: usize,
}

pub struct ImageStore {
    generation: AtomicU64,
    inner: Mutex<StoreInner>,
    max_entries: usize,
    max_total_bytes: usize,
    max_image_bytes: usize,
    entry_ttl: Duration,
}

impl Default for ImageStore {
    fn default() -> Self {
        Self {
            generation: AtomicU64::new(0),
            inner: Mutex::new(StoreInner::default()),
            max_entries: MAX_ENTRIES,
            max_total_bytes: MAX_TOTAL_BYTES,
            max_image_bytes: MAX_IMAGE_BYTES,
            entry_ttl: ENTRY_TTL,
        }
    }
}

impl ImageStore {
    pub fn insert(&self, bytes: Vec<u8>) -> Result<String, String> {
        if bytes.is_empty() {
            return Err("图片数据为空".into());
        }
        if bytes.len() > self.max_image_bytes {
            return Err("图片超过 64 MiB 限制".into());
        }
        let id = format!(
            "image-{}",
            self.generation.fetch_add(1, Ordering::Relaxed) + 1
        );
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "图片仓库状态已损坏".to_string())?;
        prune(&mut inner, self.entry_ttl);
        inner.total_bytes += bytes.len();
        inner.order.push_back(id.clone());
        inner.entries.insert(
            id.clone(),
            StoredImage {
                bytes,
                created_at: Instant::now(),
            },
        );
        while inner.entries.len() > self.max_entries || inner.total_bytes > self.max_total_bytes {
            remove_oldest(&mut inner);
        }
        Ok(id)
    }

    pub fn get(&self, id: &str) -> Result<Vec<u8>, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "图片仓库状态已损坏".to_string())?;
        prune(&mut inner, self.entry_ttl);
        inner
            .entries
            .get(id)
            .map(|entry| entry.bytes.clone())
            .ok_or_else(|| "图片已过期或不存在，请重新截取".to_string())
    }

    pub fn remove(&self, id: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(entry) = inner.entries.remove(id) {
                inner.total_bytes = inner.total_bytes.saturating_sub(entry.bytes.len());
            }
            inner.order.retain(|current| current != id);
        }
    }

    pub fn clear(&self) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "图片仓库状态已损坏".to_string())?;
        inner.entries.clear();
        inner.order.clear();
        inner.total_bytes = 0;
        Ok(())
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.inner.lock().unwrap().entries.len()
    }

    #[cfg(test)]
    fn with_limits(max_entries: usize, max_total_bytes: usize, entry_ttl: Duration) -> Self {
        Self {
            max_entries,
            max_total_bytes,
            max_image_bytes: max_total_bytes,
            entry_ttl,
            ..Self::default()
        }
    }
}

fn prune(inner: &mut StoreInner, entry_ttl: Duration) {
    let now = Instant::now();
    let expired = inner
        .order
        .iter()
        .filter(|id| {
            inner
                .entries
                .get(*id)
                .is_some_and(|entry| now.duration_since(entry.created_at) >= entry_ttl)
        })
        .cloned()
        .collect::<Vec<_>>();
    for id in expired {
        if let Some(entry) = inner.entries.remove(&id) {
            inner.total_bytes = inner.total_bytes.saturating_sub(entry.bytes.len());
        }
        inner.order.retain(|current| current != &id);
    }
}

fn remove_oldest(inner: &mut StoreInner) {
    if let Some(id) = inner.order.pop_front() {
        if let Some(entry) = inner.entries.remove(&id) {
            inner.total_bytes = inner.total_bytes.saturating_sub(entry.bytes.len());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_images() {
        assert!(ImageStore::default().insert(Vec::new()).is_err());
    }

    #[test]
    fn evicts_oldest_entries_at_capacity() {
        let store = ImageStore::default();
        let first = store.insert(vec![1]).unwrap();
        for value in 2..=13 {
            store.insert(vec![value]).unwrap();
        }
        assert_eq!(store.len(), MAX_ENTRIES);
        assert!(store.get(&first).is_err());
    }

    #[test]
    fn remove_releases_an_image() {
        let store = ImageStore::default();
        let id = store.insert(vec![1, 2, 3]).unwrap();
        store.remove(&id);
        assert!(store.get(&id).is_err());
    }

    #[test]
    fn clear_releases_the_whole_capture_session() {
        let store = ImageStore::default();
        let id = store.insert(vec![1, 2, 3]).unwrap();
        store.clear().unwrap();
        assert!(store.get(&id).is_err());
    }

    #[test]
    fn evicts_oldest_entries_at_total_byte_limit() {
        let store = ImageStore::with_limits(10, 5, ENTRY_TTL);
        let first = store.insert(vec![1, 2, 3]).unwrap();
        let second = store.insert(vec![4, 5, 6]).unwrap();
        assert!(store.get(&first).is_err());
        assert_eq!(store.get(&second).unwrap(), vec![4, 5, 6]);
    }

    #[test]
    fn expired_images_are_pruned_on_access() {
        let store = ImageStore::default();
        let id = store.insert(vec![1, 2, 3]).unwrap();
        store
            .inner
            .lock()
            .unwrap()
            .entries
            .get_mut(&id)
            .unwrap()
            .created_at = Instant::now() - ENTRY_TTL;
        assert!(store.get(&id).is_err());
        assert_eq!(store.len(), 0);
    }
}
