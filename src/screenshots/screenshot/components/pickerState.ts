export interface PixelPoint {
  x: number;
  y: number;
}
export interface PickerState {
  mode: "following" | "locked";
  point: PixelPoint | null;
}
export const INITIAL_PICKER_STATE: PickerState = { mode: "following", point: null };
type Action =
  | { type: "hover"; point: PixelPoint; width: number; height: number }
  | { type: "lock"; point: PixelPoint; width: number; height: number }
  | { type: "toggle" }
  | { type: "nudge"; dx: number; dy: number; width: number; height: number }
  | { type: "reset" };
export function clampPixel(point: PixelPoint, width: number, height: number): PixelPoint {
  return {
    x: Math.max(0, Math.min(Math.max(0, width - 1), Math.floor(point.x))),
    y: Math.max(0, Math.min(Math.max(0, height - 1), Math.floor(point.y))),
  };
}
export function pickerReducer(state: PickerState, action: Action): PickerState {
  if (action.type === "reset") return INITIAL_PICKER_STATE;
  if (action.type === "toggle")
    return state.point
      ? { ...state, mode: state.mode === "locked" ? "following" : "locked" }
      : state;
  if (action.type === "hover")
    return state.mode === "locked"
      ? state
      : { ...state, point: clampPixel(action.point, action.width, action.height) };
  if (action.type === "lock")
    return { mode: "locked", point: clampPixel(action.point, action.width, action.height) };
  if (!state.point || state.mode !== "locked") return state;
  return {
    ...state,
    point: clampPixel(
      { x: state.point.x + action.dx, y: state.point.y + action.dy },
      action.width,
      action.height,
    ),
  };
}
export function pickerKeyAction(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "isComposing">,
  textInput: boolean,
  button = false,
  blocked = false,
) {
  if (blocked || event.isComposing || textInput || event.ctrlKey || event.metaKey || event.altKey)
    return null;
  if (event.key === " " && !button) return "toggle" as const;
  if (event.key.toLowerCase() === "c") return "copy" as const;
  const directions: Record<string, "up" | "down" | "left" | "right"> = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
  };
  return directions[event.key] ?? null;
}
export const PICKER_CELL = 12;
export const PICKER_RADIUS = 5;
export const PICKER_LENS_SIZE = (PICKER_RADIUS * 2 + 1) * PICKER_CELL;
export function pickerLensCrop(point: PixelPoint, width: number, height: number) {
  const originX = point.x - PICKER_RADIUS,
    originY = point.y - PICKER_RADIUS;
  const x = Math.max(0, originX),
    y = Math.max(0, originY);
  const right = Math.min(width, point.x + PICKER_RADIUS + 1),
    bottom = Math.min(height, point.y + PICKER_RADIUS + 1);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
    left: (x - originX) * PICKER_CELL,
    top: (y - originY) * PICKER_CELL,
  };
}
export function pickerPanelPosition(
  anchor: PixelPoint,
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const gap = 20,
    margin = 8;
  const left =
    anchor.x + gap + panel.width <= viewport.width - margin
      ? anchor.x + gap
      : anchor.x - gap - panel.width;
  const top =
    anchor.y + gap + panel.height <= viewport.height - margin
      ? anchor.y + gap
      : anchor.y - gap - panel.height;
  return {
    left: Math.max(margin, Math.min(left, viewport.width - panel.width - margin)),
    top: Math.max(margin, Math.min(top, viewport.height - panel.height - margin)),
  };
}
