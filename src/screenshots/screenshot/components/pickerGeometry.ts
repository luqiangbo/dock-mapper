export const PICKER_PANEL_WIDTH = 122;
export const PICKER_PANEL_HEIGHT = 146;

export function calculatePickerPosition(
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number } {
  const margin = 4;
  const offset = 12;
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
