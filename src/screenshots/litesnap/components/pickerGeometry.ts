export const PICKER_PANEL_WIDTH = 168;
export const PICKER_PANEL_HEIGHT = 240;

export function calculatePickerPosition(
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number } {
  const margin = 8;
  const offset = 18;
  const preferredLeft = clientX + offset;
  const preferredTop = clientY + offset;
  const left = preferredLeft + PICKER_PANEL_WIDTH <= viewportWidth - margin
    ? preferredLeft
    : clientX - PICKER_PANEL_WIDTH - offset;
  const top = preferredTop + PICKER_PANEL_HEIGHT <= viewportHeight - margin
    ? preferredTop
    : clientY - PICKER_PANEL_HEIGHT - offset;
  return {
    left: Math.max(margin, Math.min(left, viewportWidth - PICKER_PANEL_WIDTH - margin)),
    top: Math.max(margin, Math.min(top, viewportHeight - PICKER_PANEL_HEIGHT - margin)),
  };
}

export function resolveScreenPoint(event: {
  clientX: number;
  clientY: number;
  screenX?: number;
  screenY?: number;
}): { screenX: number; screenY: number } {
  return {
    screenX: Math.round(event.screenX ?? event.clientX),
    screenY: Math.round(event.screenY ?? event.clientY),
  };
}
