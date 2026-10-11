import type { WidgetLayoutSettings, WidgetMetricConfig } from "./types";
import type { WidgetLayoutBudget } from "./api/screenshotTypes";

export const DEFAULT_WIDGET_LAYOUT: WidgetLayoutSettings = {
  mode: "auto",
  metric_gap: 6,
  horizontal_padding: 4,
  task_list_gap: 6,
  tray_gap: 6,
  vertical_offset: 0,
  font_size: 14,
  icon_size: 18,
};

export function widgetSpacing(layout: WidgetLayoutSettings, compact: boolean) {
  const factor = layout.mode === "auto" && compact ? 0.5 : 1;
  return { gap: layout.metric_gap * factor, padding: layout.horizontal_padding * factor };
}

export function enabledWidgetMetrics(
  metrics: readonly WidgetMetricConfig[],
  status: { cpu_usage?: number | null; battery?: unknown } | null,
) {
  return metrics.filter(
    (metric) =>
      metric.enabled &&
      (status === null ||
        ((metric.kind !== "battery" || status.battery != null) &&
          (metric.kind !== "cpu" || status.cpu_usage != null))),
  );
}

export function acceptWidgetBudget(
  current: WidgetLayoutBudget,
  next: WidgetLayoutBudget,
): WidgetLayoutBudget {
  return next.revision >= current.revision ? next : current;
}
