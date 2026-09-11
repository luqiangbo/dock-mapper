export interface WidgetResponsiveLayout {
  compact: boolean;
  visibleCount: number;
  hiddenCount: number;
  showOverflow: boolean;
}

function occupiedWidth(widths: readonly number[], padding: number, gap: number): number {
  if (widths.length === 0) return 0;
  return padding * 2 + widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
}

/** Chooses a stable prefix so metric order never changes as taskbar space changes. */
export function calculateWidgetResponsiveLayout(
  normalWidths: readonly number[],
  compactWidths: readonly number[],
  allocatedWidth: number,
  overflowWidth = 12,
): WidgetResponsiveLayout {
  const count = Math.min(normalWidths.length, compactWidths.length);
  if (count === 0)
    return { compact: false, visibleCount: 0, hiddenCount: 0, showOverflow: false };
  const budget = Math.max(0, allocatedWidth);
  if (occupiedWidth(normalWidths.slice(0, count), 4, 6) <= budget + 0.5) {
    return { compact: false, visibleCount: count, hiddenCount: 0, showOverflow: false };
  }
  if (occupiedWidth(compactWidths.slice(0, count), 2, 3) <= budget + 0.5) {
    return { compact: true, visibleCount: count, hiddenCount: 0, showOverflow: false };
  }

  let visibleCount = 0;
  for (let candidate = 1; candidate <= count; candidate += 1) {
    const hidden = candidate < count;
    const widths = compactWidths.slice(0, candidate);
    if (hidden) widths.push(overflowWidth);
    if (occupiedWidth(widths, 2, 3) > budget + 0.5) break;
    visibleCount = candidate;
  }
  // The native minimum-width contract guarantees the first metric fits. If the
  // ellipsis does not, preserve the metric and omit only the marker.
  if (visibleCount === 0 && occupiedWidth(compactWidths.slice(0, 1), 2, 3) <= budget + 0.5) {
    visibleCount = 1;
  }
  return {
    compact: true,
    visibleCount,
    hiddenCount: count - visibleCount,
    showOverflow:
      visibleCount > 0 &&
      visibleCount < count &&
      occupiedWidth([...compactWidths.slice(0, visibleCount), overflowWidth], 2, 3) <= budget + 0.5,
  };
}
