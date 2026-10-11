//! Pure layout decisions and versioned snapshots. Native operations live in taskbar.
use crate::widget::WidgetLayoutSettings;
use serde::Serialize;
use std::time::{Duration, Instant};

pub const HEIGHT: f64 = 40.0;
const GRACE: Duration = Duration::from_secs(2);
const STABLE: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WidgetLayoutRequest {
    pub preferred_width: f64,
    pub minimum_width: f64,
}

impl Default for WidgetLayoutRequest {
    fn default() -> Self {
        Self {
            preferred_width: 180.0,
            minimum_width: 48.0,
        }
    }
}

impl WidgetLayoutRequest {
    pub fn normalized(self) -> Self {
        let preferred = if self.preferred_width.is_finite() {
            self.preferred_width.clamp(1.0, 600.0)
        } else {
            180.0
        };
        let minimum = if self.minimum_width.is_finite() {
            self.minimum_width.clamp(1.0, preferred)
        } else {
            48.0_f64.min(preferred)
        };
        Self {
            preferred_width: preferred,
            minimum_width: minimum,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LayoutState {
    ProbeFailed,
    InsufficientSpace,
    Ready,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetLayoutBudget {
    pub revision: u64,
    pub state: LayoutState,
    pub allocated_width: f64,
    pub constrained: bool,
    pub visible: bool,
    pub error: Option<String>,
}

impl WidgetLayoutBudget {
    pub fn hidden(state: LayoutState, error: Option<String>) -> Self {
        Self {
            revision: 0,
            state,
            allocated_width: 0.0,
            constrained: true,
            visible: false,
            error,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct LayoutTarget {
    pub width: f64,
    pub height: f64,
    pub x: f64,
    pub y: f64,
    pub constrained: bool,
}

impl LayoutTarget {
    pub fn budget(self, state: LayoutState, error: Option<String>) -> WidgetLayoutBudget {
        WidgetLayoutBudget {
            revision: 0,
            state,
            allocated_width: self.width,
            constrained: self.constrained,
            visible: true,
            error,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum LayoutProbe {
    ProbeFailed,
    InsufficientSpace,
    Ready(LayoutTarget),
}

impl LayoutProbe {
    pub fn state(self) -> LayoutState {
        match self {
            Self::ProbeFailed => LayoutState::ProbeFailed,
            Self::InsufficientSpace => LayoutState::InsufficientSpace,
            Self::Ready(_) => LayoutState::Ready,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LayoutContext {
    pub host: isize,
    pub bounds: [i32; 4],
    pub scale: f64,
    pub request: WidgetLayoutRequest,
    // Includes metric styles/order and unit as well as native spacing.
    pub presentation: String,
}

#[derive(Default)]
pub struct WidgetLayoutController {
    pub request: WidgetLayoutRequest,
    context: Option<LayoutContext>,
    last_target: Option<LayoutTarget>,
    waiting: bool,
    failed_since: Option<Instant>,
    recovery_since: Option<Instant>,
    snapshot: Option<WidgetLayoutBudget>,
    published_revision: Option<u64>,
}

impl WidgetLayoutController {
    pub fn resolve(
        &mut self,
        context: Option<LayoutContext>,
        probe: LayoutProbe,
        now: Instant,
    ) -> Option<LayoutTarget> {
        if self.context != context {
            self.context = context;
            self.last_target = None;
            self.waiting = true;
            self.failed_since = None;
            self.recovery_since = None;
        }
        match probe {
            LayoutProbe::Ready(target) => {
                self.failed_since = None;
                if self.waiting {
                    let since = *self.recovery_since.get_or_insert(now);
                    if now.saturating_duration_since(since) < STABLE {
                        return None;
                    }
                }
                self.waiting = false;
                self.recovery_since = None;
                self.last_target = Some(target);
                Some(target)
            }
            LayoutProbe::ProbeFailed => {
                self.recovery_since = None;
                if let Some(target) = self.last_target {
                    let since = *self.failed_since.get_or_insert(now);
                    if now.saturating_duration_since(since) < GRACE {
                        return Some(target);
                    }
                }
                self.invalidate_target();
                None
            }
            LayoutProbe::InsufficientSpace => {
                self.invalidate_target();
                None
            }
        }
    }

    pub fn invalidate_target(&mut self) {
        self.last_target = None;
        self.waiting = true;
        self.failed_since = None;
        self.recovery_since = None;
    }

    pub fn complete(
        &mut self,
        probe: LayoutProbe,
        target: Option<LayoutTarget>,
        operation: Result<bool, String>,
    ) -> WidgetLayoutBudget {
        let error = matches!(probe, LayoutProbe::ProbeFailed)
            .then(|| "任务栏暂不可用，正在自动重试".to_string());
        let mut next = target
            .map(|t| t.budget(probe.state(), error.clone()))
            .unwrap_or_else(|| WidgetLayoutBudget::hidden(probe.state(), error));
        match operation {
            Ok(visible) => next.visible = visible,
            Err(error) => {
                self.invalidate_target();
                next = WidgetLayoutBudget::hidden(probe.state(), Some(error));
            }
        }
        self.commit(next)
    }

    /// Commit the actual operation result, then publish from every refresh entry.
    pub fn commit(&mut self, mut next: WidgetLayoutBudget) -> WidgetLayoutBudget {
        if let Some(previous) = &self.snapshot {
            next.revision = previous.revision;
            if *previous == next {
                return previous.clone();
            }
            next.revision += 1;
        } else {
            next.revision = 1;
        }
        self.snapshot = Some(next.clone());
        next
    }

    pub fn needs_publish(&self, snapshot: &WidgetLayoutBudget) -> bool {
        self.published_revision != Some(snapshot.revision)
    }

    pub fn mark_published(&mut self, snapshot: &WidgetLayoutBudget) {
        self.published_revision = Some(snapshot.revision);
    }
}

pub fn calculate_layout(
    taskbar: [i32; 4],
    tray: [i32; 4],
    task_list: [i32; 4],
    scale: f64,
    request: WidgetLayoutRequest,
    settings: WidgetLayoutSettings,
) -> LayoutProbe {
    if !scale.is_finite()
        || scale <= 0.0
        || [taskbar, tray, task_list]
            .iter()
            .any(|r| r[2] <= r[0] || r[3] <= r[1])
    {
        return LayoutProbe::ProbeFailed;
    }
    let request = request.normalized();
    let left =
        task_list[2].max(taskbar[0]) + (f64::from(settings.task_list_gap) * scale).ceil() as i32;
    let right = tray[0].min(taskbar[2]) - (f64::from(settings.tray_gap) * scale).ceil() as i32;
    // Allocate complete physical pixels, never round a window across its safe edge.
    let available_physical = (right - left).max(0);
    let width_physical = (request.preferred_width * scale)
        .ceil()
        .min(f64::from(available_physical));
    if width_physical < (request.minimum_width * scale).ceil() {
        return LayoutProbe::InsufficientSpace;
    }
    let height = (HEIGHT * scale)
        .round()
        .min(f64::from(taskbar[3] - taskbar[1]))
        / scale;
    let max_y = (f64::from(taskbar[3] - taskbar[1]) / scale - height).max(0.0);
    LayoutProbe::Ready(LayoutTarget {
        width: width_physical / scale,
        height,
        x: f64::from(right - taskbar[0]) / scale - width_physical / scale,
        y: (max_y / 2.0 + f64::from(settings.vertical_offset)).clamp(0.0, max_y),
        constrained: width_physical / scale + 0.01 < request.preferred_width,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn context() -> Option<LayoutContext> {
        Some(LayoutContext {
            host: 1,
            bounds: [0, 1000, 1920, 1048],
            scale: 1.0,
            request: WidgetLayoutRequest::default(),
            presentation: "default".into(),
        })
    }
    fn target() -> LayoutTarget {
        LayoutTarget {
            width: 73.0,
            height: 40.0,
            x: 1500.0,
            y: 4.0,
            constrained: true,
        }
    }
    fn visible(now: Instant) -> WidgetLayoutController {
        let mut c = WidgetLayoutController::default();
        c.resolve(context(), LayoutProbe::Ready(target()), now);
        assert!(c
            .resolve(context(), LayoutProbe::Ready(target()), now + STABLE)
            .is_some());
        c
    }
    #[test]
    fn brief_probe_failure_keeps_widget_but_persistent_failure_hides_it() {
        let now = Instant::now();
        let mut c = visible(now);
        assert!(c
            .resolve(
                context(),
                LayoutProbe::ProbeFailed,
                now + Duration::from_secs(1)
            )
            .is_some());
        assert!(c
            .resolve(
                context(),
                LayoutProbe::ProbeFailed,
                now + Duration::from_secs(2)
            )
            .is_some());
        assert!(c
            .resolve(
                context(),
                LayoutProbe::ProbeFailed,
                now + Duration::from_secs(3)
            )
            .is_none());
    }
    #[test]
    fn confirmed_shortage_hides_immediately_and_narrow_stable_space_restores_it() {
        let now = Instant::now();
        let mut c = visible(now);
        assert!(c
            .resolve(
                context(),
                LayoutProbe::InsufficientSpace,
                now + Duration::from_secs(1)
            )
            .is_none());
        assert!(c
            .resolve(
                context(),
                LayoutProbe::Ready(target()),
                now + Duration::from_secs(2)
            )
            .is_none());
        assert!(c
            .resolve(
                context(),
                LayoutProbe::Ready(target()),
                now + Duration::from_millis(2500)
            )
            .is_some());
    }
    #[test]
    fn failure_interrupts_recovery_confirmation() {
        let now = Instant::now();
        let mut c = WidgetLayoutController::default();
        c.resolve(context(), LayoutProbe::Ready(target()), now);
        c.resolve(
            context(),
            LayoutProbe::ProbeFailed,
            now + Duration::from_millis(400),
        );
        assert!(c
            .resolve(
                context(),
                LayoutProbe::Ready(target()),
                now + Duration::from_millis(600)
            )
            .is_none());
        assert!(c
            .resolve(
                context(),
                LayoutProbe::Ready(target()),
                now + Duration::from_millis(1100)
            )
            .is_some());
    }
    #[test]
    fn explorer_display_request_and_style_changes_never_reuse_cached_geometry() {
        let now = Instant::now();
        for change in 0..5 {
            let mut c = visible(now);
            let mut next = context().unwrap();
            match change {
                0 => next.host = 2,
                1 => next.scale = 1.5,
                2 => next.bounds[0] = -1920,
                3 => next.request.minimum_width = 72.0,
                _ => next.presentation = "new style".into(),
            }
            assert!(c
                .resolve(
                    Some(next),
                    LayoutProbe::ProbeFailed,
                    now + Duration::from_secs(1)
                )
                .is_none());
        }
    }
    #[test]
    fn ipc_hide_then_native_recovery_publishes_a_new_revision_even_for_the_same_width() {
        let mut c = WidgetLayoutController::default();
        let a = c.commit(target().budget(LayoutState::Ready, None));
        c.mark_published(&a);
        let hidden = c.commit(WidgetLayoutBudget::hidden(
            LayoutState::InsufficientSpace,
            None,
        ));
        let restored = c.commit(target().budget(LayoutState::Ready, None));
        assert!(restored.revision > hidden.revision && hidden.revision > a.revision);
        assert!(c.needs_publish(&restored));
        c.mark_published(&restored);
        let unchanged = c.commit(restored.clone());
        assert!(!c.needs_publish(&unchanged));
    }
    #[test]
    fn failed_native_operation_is_hidden_and_failed_publication_is_retried() {
        let mut c = WidgetLayoutController::default();
        let failed = c.complete(
            LayoutProbe::Ready(target()),
            Some(target()),
            Err("move failed".into()),
        );
        assert!(!failed.visible);
        assert!(c.needs_publish(&failed));
        assert_eq!(failed.error.as_deref(), Some("move failed"));
        assert!(c.last_target.is_none());
        let same = c.commit(failed.clone());
        assert!(c.needs_publish(&same));
    }
    #[test]
    fn safe_slot_honors_external_distances_dpi_and_vertical_clamping() {
        let settings = WidgetLayoutSettings {
            task_list_gap: 10,
            tray_gap: 20,
            vertical_offset: 12,
            ..Default::default()
        };
        let LayoutProbe::Ready(t) = calculate_layout(
            [0, 1000, 1920, 1048],
            [1660, 1000, 1920, 1048],
            [710, 1000, 1510, 1048],
            1.0,
            WidgetLayoutRequest {
                preferred_width: 300.0,
                minimum_width: 72.0,
            },
            settings,
        ) else {
            panic!()
        };
        assert_eq!(t.width, 120.0);
        assert_eq!(t.x, 1520.0);
        assert_eq!(t.y, 8.0);
        let LayoutProbe::Ready(t) = calculate_layout(
            [0, 2064, 3840, 2160],
            [3300, 2064, 3840, 2160],
            [1200, 2064, 2900, 2160],
            2.0,
            WidgetLayoutRequest {
                preferred_width: 240.0,
                minimum_width: 80.0,
            },
            Default::default(),
        ) else {
            panic!()
        };
        assert_eq!(t.width, 188.0);
    }
    #[test]
    fn only_enough_space_for_first_metric_is_ready_without_an_extra_margin() {
        let probe = calculate_layout(
            [0, 1032, 1920, 1080],
            [1660, 1032, 1920, 1080],
            [710, 1032, 1575, 1080],
            1.0,
            WidgetLayoutRequest {
                preferred_width: 130.0,
                minimum_width: 72.0,
            },
            Default::default(),
        );
        assert!(matches!(
            probe,
            LayoutProbe::Ready(LayoutTarget { width: 73.0, .. })
        ));
    }

    #[test]
    fn fractional_dpi_and_maximum_vertical_offset_stay_inside_taskbar_pixels() {
        let LayoutProbe::Ready(t) = calculate_layout(
            [-1920, 1000, 0, 1060],
            [-300, 1000, 0, 1060],
            [-1800, 1000, -700, 1060],
            1.2625,
            WidgetLayoutRequest::default(),
            WidgetLayoutSettings {
                vertical_offset: 12,
                ..Default::default()
            },
        ) else {
            panic!()
        };
        assert!((t.y * 1.2625).round() + (t.height * 1.2625).round() <= 60.0);
        assert!(t.x >= 0.0);
    }
}
