import type { WidgetMetricConfig, WidgetMetricKind } from "../types";

export function reorderVisibleMetrics(
  metrics: WidgetMetricConfig[],
  visibleKinds: WidgetMetricKind[],
  kind: WidgetMetricKind,
  targetIndex: number,
) {
  const visible = metrics.filter((metric) => visibleKinds.includes(metric.kind));
  const from = visible.findIndex((metric) => metric.kind === kind);
  if (from < 0 || targetIndex < 0 || targetIndex >= visible.length || from === targetIndex)
    return metrics;
  const [moving] = visible.splice(from, 1);
  visible.splice(targetIndex, 0, moving);
  let cursor = 0;
  return metrics.map((metric) => (visibleKinds.includes(metric.kind) ? visible[cursor++] : metric));
}

export function canDisableMetric(
  metrics: WidgetMetricConfig[],
  visibleKinds: WidgetMetricKind[],
  kind: WidgetMetricKind,
) {
  return (
    !metrics.find((metric) => metric.kind === kind)?.enabled ||
    metrics.filter((metric) => visibleKinds.includes(metric.kind) && metric.enabled).length > 1
  );
}

export interface MetricDrag {
  kind: WidgetMetricKind;
  targetIndex: number;
  active: boolean;
}
export function finishMetricDrag(
  metrics: WidgetMetricConfig[],
  visibleKinds: WidgetMetricKind[],
  drag: MetricDrag | null,
  cancelled: boolean,
) {
  return !cancelled && drag?.active
    ? reorderVisibleMetrics(metrics, visibleKinds, drag.kind, drag.targetIndex)
    : metrics;
}
