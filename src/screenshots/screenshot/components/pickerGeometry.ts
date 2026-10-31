export const PICKER_PANEL_WIDTH = 122;
export const PICKER_PANEL_HEIGHT = 146;
export const CAPTURE_LOUPE_BOUNDS = { width: 224, height: 98 };

export function calculatePickerPosition(
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
  panelSize = { width: PICKER_PANEL_WIDTH, height: PICKER_PANEL_HEIGHT },
): { left: number; top: number } {
  const margin = 4;
  const offset = 12;
  const preferredLeft = clientX + offset;
  const preferredTop = clientY + offset;
  const left =
    preferredLeft + panelSize.width <= viewportWidth - margin
      ? preferredLeft
      : clientX - panelSize.width - offset;
  const top =
    preferredTop + panelSize.height <= viewportHeight - margin
      ? preferredTop
      : clientY - panelSize.height - offset;
  return {
    left: Math.max(margin, Math.min(left, viewportWidth - panelSize.width - margin)),
    top: Math.max(margin, Math.min(top, viewportHeight - panelSize.height - margin)),
  };
}
