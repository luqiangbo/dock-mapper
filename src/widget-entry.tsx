import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CaretDownFilled, CaretUpFilled } from "@ant-design/icons";
import { Battery, Cpu, MemoryStick } from "lucide-react";
import type { MemoryScheme, SysStatus, WidgetConfig, WidgetMetricConfig, WidgetMetricKind } from "./types";
import { formatSpeedParts } from "./utils/format";
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

function CapsuleIndicator({ usage, kind }: { usage: number; kind: Exclude<WidgetMetricKind, "network"> }) {
  return (
    <div className="capsule-indicator">
      <span className="metric-icon">{metricIcon(kind)}</span>
      <span className="capsule-label" aria-label={`内存占用 ${usage.toFixed(0)}%`}>
        {usage.toFixed(0)}%
      </span>
    </div>
  );
}

function RingIndicator({ usage }: { usage: number }) {
  const radius = 9.5;
  const circumference = 2 * Math.PI * radius;
  const dash = (usage / 100) * circumference;
  return (
    <div className="ring-indicator" aria-label={`内存占用 ${usage.toFixed(0)}%`}>
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

function GaugeIndicator({ usage }: { usage: number }) {
  const filled = Math.ceil(usage / 20);
  const color = memoryColor(usage);
  return (
    <div className="gauge-indicator" aria-label={`内存占用 ${usage.toFixed(0)}%`}>
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

function MemoryIndicator({ usage, scheme, kind }: { usage: number; scheme: MemoryScheme; kind: Exclude<WidgetMetricKind, "network"> }) {
  if (scheme === "ring") return <RingIndicator usage={usage} />;
  if (scheme === "gauge") return <GaugeIndicator usage={usage} />;
  return <CapsuleIndicator usage={usage} kind={kind} />;
}

function TaskbarWidget() {
  const [status, setStatus] = useState<SysStatus>({
    upload_speed: 0,
    download_speed: 0,
    memory_usage: 0,
    network_available: true,
  });
  const [config, setConfig] = useState<WidgetConfig>(FALLBACK_CONFIG);
  const containerRef = useRef<HTMLDivElement>(null);
  const widthSyncFrame = useRef<number | null>(null);
  const pendingWidth = useRef<number | null>(null);
  const lastRequestedWidth = useRef<number | null>(null);
  const widthSyncInFlight = useRef(false);
  const widthSyncDisposed = useRef(false);

  const flushWidthSync = useCallback(() => {
    widthSyncFrame.current = null;
    if (widthSyncDisposed.current || widthSyncInFlight.current) return;

    const width = pendingWidth.current;
    pendingWidth.current = null;
    if (width === null) return;
    if (width === lastRequestedWidth.current) return;

    lastRequestedWidth.current = width;
    widthSyncInFlight.current = true;
    void invoke("sync_widget_dynamic_width", { width })
      .catch((error) => {
        if (lastRequestedWidth.current === width) lastRequestedWidth.current = null;
        console.error("任务栏挂件宽度同步失败", error);
      })
      .finally(() => {
        widthSyncInFlight.current = false;
        if (widthSyncDisposed.current) return;
        if (pendingWidth.current === lastRequestedWidth.current) pendingWidth.current = null;
        if (pendingWidth.current !== null && widthSyncFrame.current === null) {
          widthSyncFrame.current = requestAnimationFrame(flushWidthSync);
        }
      });
  }, []);

  const syncWidth = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const width = Math.ceil(container.getBoundingClientRect().width);
    if (width === pendingWidth.current) return;
    if (width === lastRequestedWidth.current) {
      pendingWidth.current = null;
      return;
    }
    pendingWidth.current = width;
    if (!widthSyncInFlight.current && widthSyncFrame.current === null) {
      widthSyncFrame.current = requestAnimationFrame(flushWidthSync);
    }
  }, [flushWidthSync]);

  useEffect(() => {
    widthSyncDisposed.current = false;
    void invoke<WidgetConfig>("get_widget_config")
      .then(setConfig)
      .catch((error) => console.error("任务栏挂件配置读取失败", error));

    const statusListener = listen<SysStatus>("sys-status-update", (event) => {
      setStatus(event.payload);
    });
    const configListener = listen<WidgetConfig>("widget-config-changed", (event) => {
      setConfig(event.payload);
    });

    syncWidth();
    void invoke("refresh_widget_position");
    // Native code refreshes immediately on width/config changes; this timer is
    // only a recovery fallback for Explorer restarts and display changes.
    const positionTimer = window.setInterval(() => void invoke("refresh_widget_position"), 15000);

    return () => {
      widthSyncDisposed.current = true;
      if (widthSyncFrame.current !== null) cancelAnimationFrame(widthSyncFrame.current);
      widthSyncFrame.current = null;
      pendingWidth.current = null;
      void statusListener.then((unlisten) => unlisten());
      void configListener.then((unlisten) => unlisten());
      window.clearInterval(positionTimer);
    };
  }, [syncWidth]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(syncWidth);
    observer.observe(container);
    syncWidth();
    const settleTimer = window.setTimeout(() => observer.disconnect(), 250);
    return () => {
      window.clearTimeout(settleTimer);
      observer.disconnect();
    };
  }, [config.metrics, syncWidth]);

  const upload = status.network_available
    ? formatSpeedParts(status.upload_speed, config.speed_unit)
    : { value: "—", unit: "" };
  const download = status.network_available
    ? formatSpeedParts(status.download_speed, config.speed_unit)
    : { value: "—", unit: "" };

  const enabled = config.metrics.filter((metric) => metric.enabled).filter((metric) => {
    if (metric.kind === "battery") return status.battery != null;
    if (metric.kind === "cpu") return status.cpu_usage != null;
    return true;
  });
  return (
    <div className="widget-container" ref={containerRef}>
      {enabled.map((metric) => {
        if (metric.kind === "network") {
          return <div key={metric.kind} className="net-speed" aria-label="实时网速">
            <div className="speed-row"><CaretUpFilled className="speed-arrow up-arrow" aria-hidden="true" /><span className="speed-value">{upload.value}</span><span className="speed-unit">{upload.unit}</span></div>
            <div className="speed-row"><CaretDownFilled className="speed-arrow down-arrow" aria-hidden="true" /><span className="speed-value">{download.value}</span><span className="speed-unit">{download.unit}</span></div>
          </div>;
        }
        const usage = metric.kind === "memory" ? status.memory_usage : metric.kind === "cpu" ? status.cpu_usage ?? 0 : status.battery?.percentage ?? 0;
        return <MemoryIndicator key={metric.kind} usage={usage} scheme={metric.usage_scheme} kind={metric.kind} />;
      })}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<TaskbarWidget />);
