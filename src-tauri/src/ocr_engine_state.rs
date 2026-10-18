use std::time::{Duration, Instant};

pub enum EngineState<E> {
    Empty,
    Ready(E),
    Failed {
        error: String,
        attempted_at: Instant,
    },
}

impl<E> EngineState<E> {
    pub fn ensure(
        &mut self,
        now: Instant,
        prepare: bool,
        load: impl FnOnce() -> Result<E, String>,
    ) -> Result<&mut E, String> {
        if let Self::Failed {
            error,
            attempted_at,
        } = self
        {
            if prepare {
                return Err(error.clone());
            }
            let remaining =
                Duration::from_secs(2).saturating_sub(now.saturating_duration_since(*attempted_at));
            if !remaining.is_zero() {
                return Err(format!(
                    "{error}；请等待 {} 秒后重试",
                    remaining.as_secs_f64().ceil() as u64
                ));
            }
        }
        if !matches!(self, Self::Ready(_)) {
            *self = match load() {
                Ok(engine) => Self::Ready(engine),
                Err(error) => Self::Failed {
                    error,
                    attempted_at: now,
                },
            };
        }
        match self {
            Self::Ready(engine) => Ok(engine),
            Self::Failed { error, .. } => Err(error.clone()),
            Self::Empty => Err("OCR 引擎状态异常".into()),
        }
    }

    pub fn recognize<R>(
        &mut self,
        now: Instant,
        current: impl Fn() -> bool,
        load: impl FnOnce() -> Result<E, String>,
        run: impl FnOnce(&mut E) -> Result<R, String>,
    ) -> Result<R, String> {
        if !current() {
            return Err("OCR 请求已取消".into());
        }
        let engine = self.ensure(now, false, load)?;
        if !current() {
            return Err("OCR 请求已取消".into());
        }
        let result = run(engine);
        if current() {
            result
        } else {
            Err("OCR 请求已取消".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn failed_initialization_retries_after_cooldown_and_reuses_success() {
        let now = Instant::now();
        let mut state = EngineState::<usize>::Empty;
        assert!(state
            .ensure(now, false, || Err("temporary failure".into()))
            .is_err());
        assert!(state
            .ensure(now + Duration::from_secs(1), false, || panic!(
                "cooldown must not load"
            ))
            .unwrap_err()
            .contains("等待 1 秒"));
        assert!(state
            .ensure(now + Duration::from_secs(3), true, || panic!(
                "preparation must not retry"
            ))
            .is_err());
        assert_eq!(
            *state
                .ensure(now + Duration::from_secs(3), false, || Ok(42))
                .unwrap(),
            42
        );
        assert_eq!(
            *state
                .ensure(now + Duration::from_secs(4), false, || panic!(
                    "ready engine is reused"
                ))
                .unwrap(),
            42
        );
    }

    #[test]
    fn ordinary_recognition_failure_keeps_ready_engine() {
        let mut state = EngineState::Ready(42);
        assert!(state
            .recognize::<()>(
                Instant::now(),
                || true,
                || panic!(),
                |_| Err("bad image".into())
            )
            .is_err());
        assert!(matches!(state, EngineState::Ready(42)));
    }

    #[test]
    fn cancellation_during_initialization_prevents_recognition_and_during_recognition_discards_result(
    ) {
        let cancelled = Cell::new(false);
        let mut state = EngineState::Empty;
        let result = state.recognize::<()>(
            Instant::now(),
            || !cancelled.get(),
            || {
                cancelled.set(true);
                Ok(42)
            },
            |_| panic!("cancelled request must not infer"),
        );
        assert_eq!(result.unwrap_err(), "OCR 请求已取消");
        cancelled.set(false);
        let result = state.recognize(
            Instant::now(),
            || !cancelled.get(),
            || panic!(),
            |_| {
                cancelled.set(true);
                Ok(42)
            },
        );
        assert_eq!(result.unwrap_err(), "OCR 请求已取消");
    }
}
