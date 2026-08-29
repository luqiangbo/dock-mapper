use super::*;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinOptions {
    pub(super) opacity: f64,
    pub(super) locked: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct PinPlacement {
    pub(super) screen_id: u32,
    slot: u32,
}

#[derive(Default)]
pub(super) struct PinRuntimeState {
    pub(super) data: HashMap<String, Arc<[u8]>>,
    pub(super) ready: HashSet<String>,
    pub(super) options: HashMap<String, PinOptions>,
    pub(super) placements: HashMap<String, PinPlacement>,
    pub(super) order: Vec<String>,
}

impl PinRuntimeState {
    pub(super) fn reserve(&mut self, id: String, data: Arc<[u8]>, screen_id: u32) -> u32 {
        let occupied = self
            .placements
            .values()
            .filter(|placement| placement.screen_id == screen_id)
            .map(|placement| placement.slot)
            .collect::<HashSet<_>>();
        let slot = (0..).find(|slot| !occupied.contains(slot)).unwrap_or(0);
        self.data.insert(id.clone(), data);
        self.options.insert(id.clone(), PinOptions::default());
        self.placements
            .insert(id.clone(), PinPlacement { screen_id, slot });
        self.order.push(id);
        slot
    }

    pub(super) fn remove(&mut self, id: &str) {
        self.data.remove(id);
        self.ready.remove(id);
        self.options.remove(id);
        self.placements.remove(id);
        self.order.retain(|candidate| candidate != id);
    }

    pub(super) fn latest(&self) -> Option<&str> {
        self.order.last().map(String::as_str)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct PinWindowLayout {
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) width: f64,
    pub(super) height: f64,
}

pub(super) const PIN_WINDOW_MARGIN: f64 = 20.0;
pub(super) const PIN_CASCADE_STEP: f64 = 28.0;

pub(super) fn pin_window_layout(
    screen: Rect,
    window_width: f64,
    window_height: f64,
    slot: u32,
) -> PinWindowLayout {
    let width = window_width.max(60.0).min(screen.width.max(60.0));
    let height = window_height.max(60.0).min(screen.height.max(60.0));
    let min_x = screen.x + PIN_WINDOW_MARGIN;
    let min_y = screen.y + PIN_WINDOW_MARGIN;
    let max_x = (screen.x + screen.width - width - PIN_WINDOW_MARGIN).max(min_x);
    let max_y = (screen.y + screen.height - height - PIN_WINDOW_MARGIN).max(min_y);
    let center_x = (screen.x + (screen.width - width) / 2.0).clamp(min_x, max_x);
    let center_y = (screen.y + (screen.height - height) / 2.0).clamp(min_y, max_y);
    let mut candidates = vec![(center_x, center_y)];
    let max_radius =
        (((max_x - min_x).max(max_y - min_y) / PIN_CASCADE_STEP).ceil() as i32 + 1).max(1);
    for radius in 1..=max_radius {
        for (dx, dy) in [
            (radius, radius),
            (-radius, radius),
            (radius, -radius),
            (-radius, -radius),
            (radius, 0),
            (0, radius),
            (-radius, 0),
            (0, -radius),
        ] {
            let candidate = (
                (center_x + dx as f64 * PIN_CASCADE_STEP).clamp(min_x, max_x),
                (center_y + dy as f64 * PIN_CASCADE_STEP).clamp(min_y, max_y),
            );
            if !candidates.iter().any(|existing| {
                (existing.0 - candidate.0).abs() < 0.5 && (existing.1 - candidate.1).abs() < 0.5
            }) {
                candidates.push(candidate);
            }
        }
    }
    let (x, y) = candidates[slot as usize % candidates.len()];
    PinWindowLayout {
        x,
        y,
        width,
        height,
    }
}

pub(super) fn logical_pin_to_physical(
    logical_screen: Rect,
    physical_origin_x: i32,
    physical_origin_y: i32,
    scale: f64,
    layout: PinWindowLayout,
) -> (i32, i32, u32, u32) {
    let scale = scale.max(1.0);
    (
        physical_origin_x + ((layout.x - logical_screen.x) * scale).round() as i32,
        physical_origin_y + ((layout.y - logical_screen.y) * scale).round() as i32,
        (layout.width * scale).round().max(1.0) as u32,
        (layout.height * scale).round().max(1.0) as u32,
    )
}

impl Default for PinOptions {
    fn default() -> Self {
        Self {
            opacity: 1.0,
            locked: false,
        }
    }
}

pub(super) fn normalized_pin_options(opacity: f64, locked: bool) -> PinOptions {
    PinOptions {
        opacity: opacity.clamp(0.2, 1.0),
        locked,
    }
}
