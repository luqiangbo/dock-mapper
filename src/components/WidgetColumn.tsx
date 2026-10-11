import type { SpeedUnit, SysStatus, WidgetMetricConfig } from "../types";
import { WidgetMetric } from "./WidgetMetric";

export function WidgetColumn({
  metrics,
  status,
  speedUnit,
  stale = false,
}: {
  metrics: readonly WidgetMetricConfig[];
  status: SysStatus | null;
  speedUnit: SpeedUnit;
  stale?: boolean;
}) {
  return (
    <div className={`wm-item wm-column${metrics.length === 2 ? " wm-column-paired" : ""}`}>
      {metrics.map((metric) => (
        <WidgetMetric
          key={metric.kind}
          metric={{ ...metric, row_layout: "single" }}
          status={status}
          speedUnit={speedUnit}
          stale={stale}
        />
      ))}
    </div>
  );
}
