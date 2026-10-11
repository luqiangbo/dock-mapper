import type { WidgetLayoutSettings, WidgetMetricKind } from "./types";
import type { WidgetLayoutBudget } from "./api/screenshotTypes";
import { DEFAULT_WIDGET_LAYOUT, widgetSpacing } from "./widgetPresentation";

export interface WidgetResponsiveLayout {
  compact: boolean;
  visibleCount: number;
  hiddenCount: number;
  showOverflow: boolean;
}

export interface WidgetLayoutReport {
  revision?: number;
  visibleKinds: WidgetMetricKind[];
  hiddenKinds: WidgetMetricKind[];
  compact: boolean;
  visible: boolean;
}

export function describeWidgetLayout(
  enabledKinds: readonly WidgetMetricKind[],
  layout: WidgetResponsiveLayout,
  visible: boolean,
  budget?: WidgetLayoutBudget,
): WidgetLayoutReport {
  const visibleCount = visible ? layout.visibleCount : 0;
  return {
    ...(budget ? { revision: budget.revision } : {}),
    visibleKinds: enabledKinds.slice(0, visibleCount),
    hiddenKinds: enabledKinds.slice(visibleCount),
    compact: layout.compact,
    visible,
  };
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
  settings: WidgetLayoutSettings = DEFAULT_WIDGET_LAYOUT,
): WidgetResponsiveLayout {
  const count = Math.min(normalWidths.length, compactWidths.length);
  if (count === 0) return { compact: false, visibleCount: 0, hiddenCount: 0, showOverflow: false };
  const budget = Math.max(0, allocatedWidth);
  const standard = widgetSpacing(settings, false);
  const compact = widgetSpacing(settings, true);
  if (
    settings.mode !== "compact" &&
    occupiedWidth(normalWidths.slice(0, count), standard.padding, standard.gap) <= budget + 0.01
  ) {
    return { compact: false, visibleCount: count, hiddenCount: 0, showOverflow: false };
  }
  const isCompact = settings.mode !== "standard";
  const spacing = isCompact ? compact : standard;
  const selectedWidths = isCompact ? compactWidths : normalWidths;
  if (
    occupiedWidth(selectedWidths.slice(0, count), spacing.padding, spacing.gap) <=
    budget + 0.01
  ) {
    return { compact: isCompact, visibleCount: count, hiddenCount: 0, showOverflow: false };
  }

  let visibleCount = 0;
  for (let candidate = 1; candidate <= count; candidate += 1) {
    const hidden = candidate < count;
    const widths = selectedWidths.slice(0, candidate);
    if (hidden) widths.push(overflowWidth);
    if (occupiedWidth(widths, spacing.padding, spacing.gap) > budget + 0.01) break;
    visibleCount = candidate;
  }
  // The native minimum-width contract guarantees the first metric fits. If the
  // ellipsis does not, preserve the metric and omit only the marker.
  if (
    visibleCount === 0 &&
    occupiedWidth(selectedWidths.slice(0, 1), spacing.padding, spacing.gap) <= budget + 0.01
  ) {
    visibleCount = 1;
  }
  return {
    compact: isCompact,
    visibleCount,
    hiddenCount: count - visibleCount,
    showOverflow:
      visibleCount > 0 &&
      visibleCount < count &&
      occupiedWidth(
        [...selectedWidths.slice(0, visibleCount), overflowWidth],
        spacing.padding,
        spacing.gap,
      ) <=
        budget + 0.01,
  };
}
