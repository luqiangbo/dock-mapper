use serde::Serialize;
use std::sync::Mutex;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Initializing,
    Ready,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub generation: u64,
    pub phase: Phase,
    pub stage: String,
    pub error: Option<String>,
    pub running: bool,
}

pub struct Tracker(Mutex<Status>);
impl Default for Tracker {
    fn default() -> Self {
        Self(Mutex::new(Status {
            generation: 0,
            phase: Phase::Initializing,
            stage: "原生应用状态".into(),
            error: None,
            running: false,
        }))
    }
}
impl Tracker {
    pub fn snapshot(&self) -> Status {
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }
    pub fn begin(&self, stage: &str) -> Result<u64, String> {
        let mut status = self.0.lock().map_err(|_| "启动状态已损坏")?;
        if status.running {
            return Err(format!(
                "{}任务仍在结束，请稍后重试；若持续无响应，请退出后重新打开",
                status.stage
            ));
        }
        status.generation += 1;
        status.phase = Phase::Initializing;
        status.stage = stage.into();
        status.error = None;
        status.running = true;
        Ok(status.generation)
    }
    pub fn stage(&self, generation: u64, stage: &str) -> Result<(), String> {
        let mut status = self.0.lock().map_err(|_| "启动状态已损坏")?;
        if status.generation != generation || status.phase != Phase::Initializing {
            return Err("本次初始化已超时，请重试".into());
        }
        status.stage = stage.into();
        Ok(())
    }
    pub fn finish(&self, generation: u64, result: Result<(), String>, ready: bool) {
        let mut status = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if status.generation != generation {
            return;
        }
        status.running = false;
        if status.phase != Phase::Initializing {
            return;
        }
        match result {
            Ok(()) => {
                if ready {
                    status.phase = Phase::Ready;
                    status.stage = "运行功能已就绪".into();
                }
            }
            Err(error) => {
                status.phase = Phase::Failed;
                status.error = Some(error);
            }
        }
    }
    pub fn timeout(&self, generation: u64) -> bool {
        let mut status = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if status.generation != generation || !status.running || status.phase != Phase::Initializing
        {
            return false;
        }
        status.phase = Phase::Failed;
        status.error = Some(format!("{}初始化超时（20 秒），请重试", status.stage));
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn timeout_is_visible_and_late_completion_cannot_replace_the_failure() {
        let tracker = Tracker::default();
        let first = tracker.begin("截图快捷键").unwrap();
        assert!(tracker.timeout(first));
        assert!(tracker.begin("重试").is_err());
        tracker.finish(first, Ok(()), true);
        assert_eq!(tracker.snapshot().phase, Phase::Failed);
        let second = tracker.begin("重试").unwrap();
        tracker.finish(first, Err("迟到的旧错误".into()), false);
        assert!(tracker.snapshot().running);
        tracker.finish(second, Ok(()), true);
        assert_eq!(tracker.snapshot().phase, Phase::Ready);
    }
    #[test]
    fn retry_preserves_the_new_stage_and_rejects_duplicate_initialization() {
        let tracker = Tracker::default();
        let first = tracker.begin("配置").unwrap();
        tracker.finish(first, Err("无法读取配置".into()), false);
        let second = tracker.begin("配置").unwrap();
        tracker.stage(second, "任务栏挂件").unwrap();
        assert!(tracker.begin("重复请求").is_err());
        assert!(tracker.stage(first, "旧阶段").is_err());
        assert_eq!(tracker.snapshot().stage, "任务栏挂件");
    }
}
