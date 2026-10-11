import type { CSSProperties } from "react";
import type { SysStatus, WidgetConfig } from "../types";
import { enabledWidgetMetrics, widgetSpacing } from "../widgetPresentation";
import { WidgetColumn } from "./WidgetColumn";
import { buildWidgetColumns } from "../widgetColumns";
import styles from "./components.module.scss";

export function WidgetPreview({
  config,
  status,
  compact,
}: {
  config: WidgetConfig;
  status: SysStatus | null;
  compact: boolean;
}) {
  const spacing = widgetSpacing(config.layout, compact);
  return (
    <div className={styles.widgetPreview}>
      <span className={styles.previewBoundary} aria-label="任务栏图标边界">
        ▦
      </span>
      <div
        className={`wm-row${compact ? " wm-compact" : ""}`}
        aria-label="任务栏挂件实时预览"
        style={
          {
            "--wm-gap": `${spacing.gap}px`,
            "--wm-padding": `${spacing.padding}px`,
            height: 40,
            width: "max-content",
            marginLeft: config.layout.task_list_gap,
            marginRight: config.layout.tray_gap,
            transform: `translateY(${Math.max(-4, Math.min(4, config.layout.vertical_offset))}px)`,
          } as CSSProperties
        }
      >
        {buildWidgetColumns(enabledWidgetMetrics(config.metrics, status)).map((column) => (
          <WidgetColumn
            key={column[0].kind}
            metrics={column}
            status={status}
            speedUnit={config.speed_unit}
          />
        ))}
      </div>
      <span className={styles.previewBoundary} aria-label="托盘边界">
        ⋯
      </span>
    </div>
  );
}
