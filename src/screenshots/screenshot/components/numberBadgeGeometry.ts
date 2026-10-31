export interface BadgeMeasurement {
  width: number;
  ascent: number;
  descent: number;
}
export function numberBadgeGeometry(
  point: { x: number; y: number },
  displaySize: number,
  zoom: number,
  text: BadgeMeasurement,
  _bounds: { width: number; height: number },
) {
  const scale = 1 / Math.max(0.01, zoom);
  const fontSize = displaySize * 0.56 * scale;
  // The click is always the badge center. The capture boundary clips, never relocates it.
  const diameter = displaySize * scale;
  const requested = Math.max(diameter, text.width + 14 * scale);
  const border = 1.5 * scale;
  const x = point.x - diameter / 2;
  const y = point.y - diameter / 2;
  const fit = Math.min(1, diameter / Math.max(1, requested));
  const measuredWidth = text.width * fit;
  const adjustedFont = fontSize * fit;
  // The registered font's baseline is exactly one fontSize below its text top.
  const textY = y + diameter / 2 + ((text.ascent - text.descent) * fit) / 2 - adjustedFont;
  return {
    x,
    y,
    diameter,
    fontSize: adjustedFont,
    textX: x + (diameter - measuredWidth) / 2,
    textY,
    border,
  };
}
