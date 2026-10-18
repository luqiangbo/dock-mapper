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
  bounds: { width: number; height: number },
) {
  const scale = 1 / Math.max(0.01, zoom);
  const fontSize = displaySize * 0.56 * scale;
  // Remain circular for multi-digit numbers, allowing at least 7 DIP side padding.
  const requested = Math.max(displaySize * scale, text.width + 14 * scale);
  const border = Math.min(1.5 * scale, bounds.width / 8, bounds.height / 8);
  const diameter = Math.min(requested, bounds.width - border, bounds.height - border);
  const x = Math.max(
    border / 2,
    Math.min(bounds.width - border / 2 - diameter, point.x - diameter / 2),
  );
  const y = Math.max(
    border / 2,
    Math.min(bounds.height - border / 2 - diameter, point.y - diameter / 2),
  );
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
