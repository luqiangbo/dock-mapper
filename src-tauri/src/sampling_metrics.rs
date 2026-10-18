use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimingStats {
    pub count: u64,
    pub total_ms: f64,
    pub average_ms: f64,
    pub last_ms: f64,
    pub max_ms: f64,
}
struct Inner {
    started_at: Instant,
    system: TimingStats,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SamplingSnapshot {
    pub measured_seconds: f64,
    pub system: TimingStats,
}
#[derive(Clone)]
pub struct SamplingMetrics(Arc<Mutex<Inner>>);
impl Default for SamplingMetrics {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(Inner {
            started_at: Instant::now(),
            system: TimingStats::default(),
        })))
    }
}
impl SamplingMetrics {
    pub fn record(&self, elapsed: Duration) {
        if let Ok(mut inner) = self.0.lock() {
            let stats = &mut inner.system;
            stats.count += 1;
            stats.last_ms = elapsed.as_secs_f64() * 1000.0;
            stats.total_ms += stats.last_ms;
            stats.average_ms = stats.total_ms / stats.count as f64;
            stats.max_ms = stats.max_ms.max(stats.last_ms);
        }
    }
    pub fn snapshot(&self) -> Result<SamplingSnapshot, String> {
        let inner = self.0.lock().map_err(|_| "采样统计状态不可用")?;
        Ok(SamplingSnapshot {
            measured_seconds: inner.started_at.elapsed().as_secs_f64(),
            system: inner.system.clone(),
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn system_sampling_keeps_timing_without_removed_sensor_statistics() {
        let metrics = SamplingMetrics::default();
        metrics.record(Duration::from_millis(25));
        metrics.record(Duration::from_millis(5));
        let snapshot = metrics.snapshot().unwrap();
        assert_eq!(
            (
                snapshot.system.count,
                snapshot.system.total_ms,
                snapshot.system.average_ms,
                snapshot.system.last_ms,
                snapshot.system.max_ms
            ),
            (2, 30.0, 15.0, 5.0, 25.0)
        );
        assert_eq!(
            SamplingMetrics::default().snapshot().unwrap().system.count,
            0
        );
        let value = serde_json::to_value(snapshot).unwrap();
        assert!(value.get("gpu").is_none() && value.get("temperature").is_none());
    }
}
