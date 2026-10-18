import { Battery, Cpu, MemoryStick } from "lucide-react";
import type {
  SysStatus,
  WidgetIconStyle,
  WidgetMetricConfig,
  WidgetMetricKind,
  SpeedUnit,
} from "../types";
import { formatSpeedParts } from "../utils/format";
import "../widgetMetrics.scss";

const LABELS = {
  cpu: "CPU",
  memory: "内存",
  battery: "电池",
};

function ResourceIcon({
  kind,
  style,
}: {
  kind: Exclude<WidgetMetricKind, "network" | "upload" | "download">;
  style: WidgetIconStyle;
}) {
  if (style === "text")
    return (
      <span className="wm-icon-text" aria-hidden="true">
        {LABELS[kind]}
      </span>
    );
  const Icon = kind === "cpu" ? Cpu : kind === "battery" ? Battery : MemoryStick;
  if (style === "outline")
    return (
      <span className="wm-icon" aria-hidden="true">
        <Icon />
      </span>
    );
  return (
    <span className="wm-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor">
        {kind === "cpu" ? (
          <path
            fillRule="evenodd"
            d="M6 4h12v2h2v12h-2v2H6v-2H4V6h2V4zm2 4v8h8V8H8zM8 1h2v3H8zm6 0h2v3h-2zM8 20h2v3H8zm6 0h2v3h-2zM1 8h3v2H1zm0 6h3v2H1zm19-6h3v2h-3zm0 6h3v2h-3z"
          />
        ) : kind === "battery" ? (
          <path fillRule="evenodd" d="M2 5h18v14H2V5zm3 3v8h12V8H5zm16 1h2v6h-2zM6 9h10v6H6z" />
        ) : (
          <path
            fillRule="evenodd"
            d="M2 5h20v12h-2v3h-2v-3h-3v3h-2v-3h-3v3H8v-3H5v3H3v-3H2V5zm3 3v6h4V8H5zm6 0v6h3V8h-3zm5 0v6h3V8h-3z"
          />
        )}
      </svg>
    </span>
  );
}

function Direction({ up, style }: { up: boolean; style: WidgetIconStyle }) {
  if (style === "text")
    return (
      <span className="wm-direction-text" aria-hidden="true">
        {up ? "上传" : "下载"}
      </span>
    );
  return (
    <span className="wm-direction" aria-hidden="true">
      <svg viewBox="0 0 12 12">
        {style === "filled" ? (
          <path fill="currentColor" d={up ? "M6 1 11 9H1z" : "M1 3h10L6 11z"} />
        ) : (
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            d={up ? "M6 10V2M2 6l4-4 4 4" : "M6 2v8M2 6l4 4 4-4"}
          />
        )}
      </svg>
    </span>
  );
}

export function WidgetMetric({
  metric,
  status,
  speedUnit,
  stale = false,
}: {
  metric: WidgetMetricConfig;
  status: SysStatus | null;
  speedUnit: SpeedUnit;
  stale?: boolean;
}) {
  const style = metric.icon_style;
  if (metric.kind === "network" || metric.kind === "upload" || metric.kind === "download") {
    const speed = (up: boolean) =>
      status?.network_available
        ? formatSpeedParts(up ? status.upload_speed : status.download_speed, speedUnit)
        : { value: "—", unit: "" };
    return (
      <div
        className={`wm-network wm-${metric.row_layout}${style === "text" ? " wm-text-direction" : ""}`}
        aria-label={status ? "实时网速" : stale ? "网速数据已过期" : "网速等待采样"}
      >
        {(metric.kind === "network" ? [true, false] : [metric.kind === "upload"]).map((up) => {
          const value = speed(up);
          return (
            <div
              className="wm-speed-row"
              key={String(up)}
              aria-label={`${up ? "上传" : "下载"} ${value.value} ${value.unit}`}
            >
              <Direction up={up} style={style} />
              <span className="wm-speed-value">{value.value}</span>
              <span className="wm-speed-unit">{value.unit}</span>
            </div>
          );
        })}
      </div>
    );
  }
  const raw = !status
    ? null
    : metric.kind === "cpu"
      ? status.cpu_usage
      : metric.kind === "battery"
        ? status.battery?.percentage
        : status.memory_usage;
  const usage = raw == null || !Number.isFinite(raw) ? null : Math.max(0, Math.min(100, raw));
  const text = usage === null ? "—" : usage.toFixed(0) + "%";
  const color =
    usage === null
      ? "var(--text-secondary)"
      : usage < 70
        ? "#35c985"
        : usage < 90
          ? "#f2a33a"
          : "#ff5d67";
  const label = `${LABELS[metric.kind]}${usage === null ? (stale ? "数据已过期" : "等待采样") : ` ${text}`}`;
  const radius = 9.5;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      className={`wm-resource wm-scheme-${metric.usage_scheme} wm-${metric.row_layout}`}
      aria-label={label}
      title={usage === null ? label : undefined}
    >
      <ResourceIcon kind={metric.kind} style={style} />
      <span className="wm-data">
        {metric.usage_scheme === "ring" && (
          <span className="wm-ring">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle
                className="wm-track"
                cx="12"
                cy="12"
                r={radius}
                fill="none"
                strokeWidth="2.8"
              />
              <circle
                cx="12"
                cy="12"
                r={radius}
                fill="none"
                stroke={color}
                strokeWidth="2.8"
                strokeDasharray={`${((usage ?? 0) / 100) * circumference} ${circumference}`}
                transform="rotate(-90 12 12)"
              />
            </svg>
          </span>
        )}
        <span className="wm-value">{text}</span>
      </span>
    </div>
  );
}
