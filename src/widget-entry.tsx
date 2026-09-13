import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { CaretDownFilled, CaretUpFilled } from "@ant-design/icons";
import { Battery, Cpu, MemoryStick } from "lucide-react";
import type {
  MemoryScheme,
  SysStatus,
  WidgetConfig,
  WidgetMetricConfig,
  WidgetMetricKind,
} from "./types";
import { formatSpeedParts } from "./utils/format";
import { calculateWidgetResponsiveLayout } from "./widgetLayout";
import { invokeCommand } from "./api/ipc";
import type { WidgetLayoutBudget } from "./api/screenshotTypes";
import "./widget.scss";

const FALLBACK_METRICS: WidgetMetricConfig[] = [
  { kind: "network", enabled: true, usage_scheme: "capsule" },
  { kind: "memory", enabled: true, usage_scheme: "capsule" },
];
const FALLBACK_CONFIG: WidgetConfig = {
  memory_scheme: "capsule",
  metrics: FALLBACK_METRICS,
  refresh_interval_secs: 1,
  network_interface: null,
  speed_unit: "auto",
};

interface WidgetMeasurements {
  preferredWidth: number;
  minimumWidth: number;
  normalWidths: number[];
  compactWidths: number[];
}

const INITIAL_BUDGET: WidgetLayoutBudget = {
  allocatedWidth: 180,
  constrained: false,
  visible: true,
};

function memoryColor(usage: number): string {
  if (usage < 70) return "#35c985";
  if (usage < 90) return "#f2a33a";
  return "#ff5d67";
}

function metricIcon(kind: Exclude<WidgetMetricKind, "network">): ReactNode {
  if (kind === "cpu") return <Cpu />;
  if (kind === "battery") return <Battery />;
  return <MemoryStick />;
}

function metricLabel(kind: Exclude<WidgetMetricKind, "network">): string {
  if (kind === "cpu") return "CPU";
  if (kind === "battery") return "电池";
  return "内存";
}

function CapsuleIndicator({
  usage,
  kind,
}: {
  usage: number;
  kind: Exclude<WidgetMetricKind, "network">;
}) {
  return (
    <div className="capsule-indicator">
      <span className="metric-icon">{metricIcon(kind)}</span>
      <span className="capsule-label" aria-label={`${metricLabel(kind)}占用 ${usage.toFixed(0)}%`}>
        {usage.toFixed(0)}%
      </span>
    </div>
  );
}

function RingIndicator({
  usage,
  kind,
}: {
  usage: number;
  kind: Exclude<WidgetMetricKind, "network">;
}) {
  const radius = 9.5;
  const circumference = 2 * Math.PI * radius;
  const dash = (usage / 100) * circumference;
  return (
    <div className="ring-indicator" aria-label={`${metricLabel(kind)}占用 ${usage.toFixed(0)}%`}>
      <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="ring-track" cx="12" cy="12" r={radius} fill="none" strokeWidth="2.8" />
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke={memoryColor(usage)}
          strokeWidth="2.8"
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 12 12)"
        />
      </svg>
      <span className="ring-core">{usage.toFixed(0)}</span>
    </div>
  );
}

function GaugeIndicator({
  usage,
  kind,
}: {
  usage: number;
  kind: Exclude<WidgetMetricKind, "network">;
}) {
  const filled = Math.ceil(usage / 20);
  const color = memoryColor(usage);
  return (
    <div className="gauge-indicator" aria-label={`${metricLabel(kind)}占用 ${usage.toFixed(0)}%`}>
      <div className="gauge-blocks" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <span
            key={index}
            className="gauge-block"
            style={index < filled ? { backgroundColor: color } : undefined}
          />
        ))}
      </div>
      <span className="gauge-label">{usage.toFixed(0)}%</span>
    </div>
  );
}

function UsageIndicator({
  usage,
  scheme,
  kind,
}: {
  usage: number;
  scheme: MemoryScheme;
  kind: Exclude<WidgetMetricKind, "network">;
}) {
  if (scheme === "ring") return <RingIndicator usage={usage} kind={kind} />;
  if (scheme === "gauge") return <GaugeIndicator usage={usage} kind={kind} />;
  return <CapsuleIndicator usage={usage} kind={kind} />;
}

interface MetricContentProps {
  metric: WidgetMetricConfig;
  status: SysStatus;
  upload: ReturnType<typeof formatSpeedParts>;
  download: ReturnType<typeof formatSpeedParts>;
}

function MetricContent({
  metric,
  status,
  upload,
  download,
}: MetricContentProps): React.JSX.Element {
  if (metric.kind === "network") {
    return (
      <div className="net-speed" aria-label="实时网速">
        <div className="speed-row">
          <CaretUpFilled className="speed-arrow up-arrow" aria-hidden="true" />
          <span className="speed-value">{upload.value}</span>
          <span className="speed-unit">{upload.unit}</span>
        </div>
        <div className="speed-row">
          <CaretDownFilled className="speed-arrow down-arrow" aria-hidden="true" />
          <span className="speed-value">{download.value}</span>
          <span className="speed-unit">{download.unit}</span>
        </div>
      </div>
    );
  }
  const usage =
    metric.kind === "memory"
      ? status.memory_usage
      : metric.kind === "cpu"
        ? (status.cpu_usage ?? 0)
        : (status.battery?.percentage ?? 0);
  return <UsageIndicator usage={usage} scheme={metric.usage_scheme} kind={metric.kind} />;
}

function sameMeasurements(a: WidgetMeasurements, b: WidgetMeasurements): boolean {
  return (
    a.preferredWidth === b.preferredWidth &&
    a.minimumWidth === b.minimumWidth &&
    a.normalWidths.join(",") === b.normalWidths.join(",") &&
    a.compactWidths.join(",") === b.compactWidths.join(",")
  );
}

function TaskbarWidget() {
  const [status, setStatus] = useState<SysStatus>({
    upload_speed: 0,
    download_speed: 0,
    memory_usage: 0,
    network_available: true,
  });
  const [config, setConfig] = useState<WidgetConfig>(FALLBACK_CONFIG);
  const [budget, setBudget] = useState<WidgetLayoutBudget>(INITIAL_BUDGET);
  const [measurements, setMeasurements] = useState<WidgetMeasurements>({
    preferredWidth: 180,
    minimumWidth: 48,
    normalWidths: [],
    compactWidths: [],
  });
  const normalMeasureRef = useRef<HTMLDivElement>(null);
  const compactMeasureRef = useRef<HTMLDivElement>(null);
  const normalItemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const compactItemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const measureFrame = useRef<number | null>(null);
  const syncFrame = useRef<number | null>(null);
  const pendingRequest = useRef<{ preferredWidth: number; minimumWidth: number } | null>(null);
  const lastRequestKey = useRef<string | null>(null);
  const syncInFlight = useRef(false);
  const disposed = useRef(false);

  const upload = status.network_available
    ? formatSpeedParts(status.upload_speed, config.speed_unit)
    : { value: "—", unit: "" };
  const download = status.network_available
    ? formatSpeedParts(status.download_speed, config.speed_unit)
    : { value: "—", unit: "" };
  const enabled = config.metrics
    .filter((metric) => metric.enabled)
    .filter((metric) => {
      if (metric.kind === "battery") return status.battery != null;
      if (metric.kind === "cpu") return status.cpu_usage != null;
      return true;
    });
  const enabledKey = enabled.map((metric) => `${metric.kind}:${metric.usage_scheme}`).join("|");

  const flushLayoutSync = useCallback(() => {
    syncFrame.current = null;
    if (disposed.current || syncInFlight.current) return;
    const request = pendingRequest.current;
    pendingRequest.current = null;
    if (!request) return;
    const key = `${request.preferredWidth}:${request.minimumWidth}`;
    if (key === lastRequestKey.current) return;
    lastRequestKey.current = key;
    syncInFlight.current = true;
    void invokeCommand("sync_widget_dynamic_width", request)
      .then((nextBudget) => {
        if (!disposed.current) setBudget(nextBudget);
      })
      .catch((error) => {
        if (lastRequestKey.current === key) lastRequestKey.current = null;
        console.error("任务栏挂件安全布局同步失败", error);
      })
      .finally(() => {
        syncInFlight.current = false;
        if (!disposed.current && pendingRequest.current && syncFrame.current === null) {
          syncFrame.current = requestAnimationFrame(flushLayoutSync);
        }
      });
  }, []);

  useEffect(() => {
    pendingRequest.current = {
      preferredWidth: measurements.preferredWidth,
      minimumWidth: measurements.minimumWidth,
    };
    if (!syncInFlight.current && syncFrame.current === null) {
      syncFrame.current = requestAnimationFrame(flushLayoutSync);
    }
  }, [flushLayoutSync, measurements.minimumWidth, measurements.preferredWidth]);

  useEffect(() => {
    disposed.current = false;
    void invokeCommand("get_widget_config")
      .then(setConfig)
      .catch((error) => console.error("任务栏挂件配置读取失败", error));

    const statusListener = listen<SysStatus>("sys-status-update", (event) => {
      setStatus(event.payload);
    });
    const configListener = listen<WidgetConfig>("widget-config-changed", (event) => {
      setConfig(event.payload);
    });
    const refreshPosition = (): void => {
      void invokeCommand("refresh_widget_position")
        .then((nextBudget) => {
          if (!disposed.current) setBudget(nextBudget);
        })
        .catch((error) => console.error("任务栏挂件位置刷新失败", error));
    };
    refreshPosition();
    const positionTimer = window.setInterval(refreshPosition, 2000);

    return () => {
      disposed.current = true;
      if (measureFrame.current !== null) cancelAnimationFrame(measureFrame.current);
      if (syncFrame.current !== null) cancelAnimationFrame(syncFrame.current);
      measureFrame.current = null;
      syncFrame.current = null;
      pendingRequest.current = null;
      void statusListener.then((unlisten) => unlisten());
      void configListener.then((unlisten) => unlisten());
      window.clearInterval(positionTimer);
    };
  }, []);

  const measureContent = useCallback(() => {
    if (measureFrame.current !== null) return;
    measureFrame.current = requestAnimationFrame(() => {
      measureFrame.current = null;
      const normalRow = normalMeasureRef.current;
      const compactRow = compactMeasureRef.current;
      if (!normalRow || !compactRow) return;
      const normalWidths = normalItemRefs.current
        .slice(0, enabled.length)
        .map((item) => Math.ceil(item?.getBoundingClientRect().width ?? 0));
      const compactWidths = compactItemRefs.current
        .slice(0, enabled.length)
        .map((item) => Math.ceil(item?.getBoundingClientRect().width ?? 0));
      const next: WidgetMeasurements = {
        preferredWidth: Math.max(48, Math.ceil(normalRow.getBoundingClientRect().width)),
        minimumWidth: Math.max(48, (compactWidths[0] ?? 44) + 4),
        normalWidths,
        compactWidths,
      };
      setMeasurements((current) => (sameMeasurements(current, next) ? current : next));
    });
  }, [enabled.length]);

  useLayoutEffect(() => {
    const normalRow = normalMeasureRef.current;
    const compactRow = compactMeasureRef.current;
    if (!normalRow || !compactRow) return;
    const observer = new ResizeObserver(measureContent);
    observer.observe(normalRow);
    observer.observe(compactRow);
    normalItemRefs.current
      .slice(0, enabled.length)
      .forEach((item) => item && observer.observe(item));
    compactItemRefs.current
      .slice(0, enabled.length)
      .forEach((item) => item && observer.observe(item));
    measureContent();
    return () => observer.disconnect();
  }, [enabled.length, enabledKey, measureContent]);

  const responsive =
    measurements.normalWidths.length === enabled.length
      ? calculateWidgetResponsiveLayout(
          measurements.normalWidths,
          measurements.compactWidths,
          budget.allocatedWidth,
        )
      : {
          compact: budget.constrained,
          visibleCount: enabled.length,
          hiddenCount: 0,
          showOverflow: false,
        };
  const visibleMetrics = enabled.slice(0, responsive.visibleCount);

  const renderMetric = (metric: WidgetMetricConfig): React.JSX.Element => (
    <MetricContent
      key={metric.kind}
      metric={metric}
      status={status}
      upload={upload}
      download={download}
    />
  );

  return (
    <>
      <div
        className={`widget-container${responsive.compact ? " is-compact" : ""}`}
        aria-hidden={!budget.visible}
      >
        {visibleMetrics.length ? (
          visibleMetrics.map((metric) => (
            <div key={metric.kind} className="widget-metric">
              {renderMetric(metric)}
            </div>
          ))
        ) : (
          <span className="widget-empty" aria-label="暂无可用挂件指标">
            —
          </span>
        )}
        {responsive.showOverflow && (
          <span
            className="widget-overflow"
            title={`另有 ${responsive.hiddenCount} 项指标因空间不足已收起`}
            aria-label={`另有 ${responsive.hiddenCount} 项指标已收起`}
          >
            …
          </span>
        )}
      </div>

      <div className="widget-measurements" aria-hidden="true">
        <div ref={normalMeasureRef} className="widget-container widget-measure-row">
          {enabled.map((metric, index) => (
            <div
              key={metric.kind}
              ref={(node) => {
                normalItemRefs.current[index] = node;
              }}
              className="widget-metric"
            >
              {renderMetric(metric)}
            </div>
          ))}
        </div>
        <div ref={compactMeasureRef} className="widget-container widget-measure-row is-compact">
          {enabled.map((metric, index) => (
            <div
              key={metric.kind}
              ref={(node) => {
                compactItemRefs.current[index] = node;
              }}
              className="widget-metric"
            >
              {renderMetric(metric)}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<TaskbarWidget />);
