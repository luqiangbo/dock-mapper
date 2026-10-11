import type { WidgetMetricConfig, WidgetMetricKind } from "./types";

/** Each ordered column owns one or two complete metric rows. */
export function buildWidgetColumns(metrics: readonly WidgetMetricConfig[]): WidgetMetricConfig[][] {
  const used = new Set<WidgetMetricKind>();
  const columns: WidgetMetricConfig[][] = [];
  for (const metric of metrics) {
    if (used.has(metric.kind)) continue;
    used.add(metric.kind);
    const partner = metrics.find(
      (other) =>
        other.kind !== metric.kind &&
        other.kind === metric.pair_with &&
        other.pair_with === metric.kind &&
        !used.has(other.kind),
    );
    if (partner) used.add(partner.kind);
    columns.push(partner ? [metric, partner] : [metric]);
  }
  return columns;
}

/** Re-pairing releases both former partners, so columns can never have three rows. */
export function pairWidgetMetrics(
  metrics: readonly WidgetMetricConfig[],
  kind: WidgetMetricKind,
  partner: WidgetMetricKind | null,
): WidgetMetricConfig[] {
  const target = partner !== kind && metrics.some((m) => m.kind === partner) ? partner : null;
  return metrics.map((metric) => {
    if (metric.kind === kind) return { ...metric, row_layout: "single", pair_with: target };
    if (metric.kind === target) return { ...metric, row_layout: "single", pair_with: kind };
    if (metric.pair_with === kind || (target !== null && metric.pair_with === target))
      return { ...metric, pair_with: null };
    return { ...metric };
  });
}

export function describeWidgetColumns(
  columns: readonly WidgetMetricConfig[][],
  visibleCount: number,
) {
  return {
    visibleKinds: columns.slice(0, visibleCount).flatMap((column) => column.map((m) => m.kind)),
    hiddenKinds: columns.slice(visibleCount).flatMap((column) => column.map((m) => m.kind)),
  };
}
