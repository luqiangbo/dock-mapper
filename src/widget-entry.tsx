import { useWindowTheme } from "./hooks/useWindowTheme";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import ReactDOM from "react-dom/client";
import { emit, listen } from "@tauri-apps/api/event";
import type { SysStatus, WidgetConfig } from "./types";
import { calculateWidgetResponsiveLayout, type WidgetLayoutReport } from "./widgetLayout";
import {
  DEFAULT_WIDGET_LAYOUT,
  acceptWidgetBudget,
  enabledWidgetMetrics,
  widgetSpacing,
} from "./widgetPresentation";
import { WidgetColumn } from "./components/WidgetColumn";
import { buildWidgetColumns, describeWidgetColumns } from "./widgetColumns";
import { useTelemetryFreshness } from "./utils/telemetryFreshness";
import { invokeCommand } from "./api/ipc";
import type { WidgetLayoutBudget } from "./api/screenshotTypes";
import "./widget.scss";

const FALLBACK_CONFIG: WidgetConfig = {
  memory_scheme: "capsule",
  layout: { ...DEFAULT_WIDGET_LAYOUT },
  metrics: [
    {
      kind: "upload",
      pair_with: "download",
      enabled: true,
      usage_scheme: "capsule",
      icon_style: "outline",
      row_layout: "single",
    },
    {
      kind: "download",
      pair_with: "upload",
      enabled: true,
      usage_scheme: "capsule",
      icon_style: "outline",
      row_layout: "single",
    },
    {
      kind: "memory",
      enabled: true,
      usage_scheme: "capsule",
      icon_style: "outline",
      row_layout: "single",
    },
  ],
  refresh_interval_secs: 1,
  network_interface: null,
  speed_unit: "auto",
  alerts: { cpu_percent: null, memory_percent: null, battery_below_percent: null },
  presets: [],
};
const INITIAL_BUDGET: WidgetLayoutBudget = {
  revision: 0,
  state: "probeFailed",
  error: null,
  allocatedWidth: 0,
  constrained: true,
  visible: false,
};
const MEASUREMENT_STATUS: SysStatus = {
  upload_speed: 99_999_999,
  download_speed: 99_999_999,
  memory_usage: 100,
  network_available: true,
  cpu_usage: 100,
  cpu_temperature_celsius: 100,
  gpu_usage: 100,
  battery: { percentage: 100, charging: false },
};
interface Measurements {
  preferredWidth: number;
  minimumWidth: number;
  normalWidths: number[];
  compactWidths: number[];
  key: string;
}

function TaskbarWidget() {
  useWindowTheme();
  const [status, setStatus] = useState<SysStatus | null>(null);
  const [lastSampleAt, setLastSampleAt] = useState<number | null>(null);
  const freshness = useTelemetryFreshness(lastSampleAt);
  const liveStatus = freshness === "live" ? status : null;
  const [config, setConfig] = useState<WidgetConfig>(FALLBACK_CONFIG);
  const [budget, setBudget] = useState<WidgetLayoutBudget>(INITIAL_BUDGET);
  const [error, setError] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<Measurements>({
    preferredWidth: 180,
    minimumWidth: 48,
    normalWidths: [],
    compactWidths: [],
    key: "",
  });
  const normalRow = useRef<HTMLDivElement>(null);
  const compactRow = useRef<HTMLDivElement>(null);
  const measureFrame = useRef<number | null>(null);
  const syncInFlight = useRef(false);
  const retryTimer = useRef<number | null>(null);
  const pendingRequest = useRef<{ preferredWidth: number; minimumWidth: number } | null>(null);
  const lastRequestKey = useRef<string | null>(null);
  const disposed = useRef(false);
  const reportRef = useRef<WidgetLayoutReport>({
    visibleKinds: [],
    hiddenKinds: [],
    compact: false,
    visible: false,
  });
  const applyBudget = useCallback((next: WidgetLayoutBudget) => {
    if (!disposed.current) setBudget((current) => acceptWidgetBudget(current, next));
  }, []);
  const enabled = enabledWidgetMetrics(config.metrics, status);
  const columns = buildWidgetColumns(enabled);
  const enabledKey = enabled
    .map((m) => `${m.kind}:${m.usage_scheme}:${m.icon_style}:${m.pair_with ?? ""}`)
    .join("|");
  const presentationKey = `${enabledKey}:${config.speed_unit}:${JSON.stringify(config.layout)}`;
  const normalSpacing = widgetSpacing(config.layout, false);
  const compactSpacing = widgetSpacing(config.layout, true);
  const rowStyle = (compact: boolean): CSSProperties => {
    const spacing = compact ? compactSpacing : normalSpacing;
    return {
      "--wm-gap": `${spacing.gap}px`,
      "--wm-padding": `${spacing.padding}px`,
      "--wm-font-size": `${config.layout.font_size}px`,
      "--wm-icon-size": `${config.layout.icon_size}px`,
    } as CSSProperties;
  };
  const fail = useCallback((message: string, cause: unknown) => {
    console.error(message, cause);
    if (!disposed.current) setError(message);
  }, []);

  const flush = useCallback(() => {
    if (disposed.current || syncInFlight.current) return;
    const request = pendingRequest.current;
    pendingRequest.current = null;
    if (!request) return;
    const key = `${request.preferredWidth}:${request.minimumWidth}`;
    if (lastRequestKey.current === key) return;
    lastRequestKey.current = key;
    syncInFlight.current = true;
    void invokeCommand("sync_widget_dynamic_width", request)
      .then((next) => {
        applyBudget(next);
        if (!disposed.current)
          setError((current) => (current === "挂件布局同步失败，正在重试" ? null : current));
      })
      .catch((cause) => {
        lastRequestKey.current = null;
        pendingRequest.current ??= request;
        fail("挂件布局同步失败，正在重试", cause);
        if (!disposed.current && retryTimer.current === null) {
          retryTimer.current = window.setTimeout(() => {
            retryTimer.current = null;
            flush();
          }, 1_000);
        }
      })
      .finally(() => {
        syncInFlight.current = false;
        // New measurements run immediately; failed requests retry with a bounded delay.
        if (!disposed.current && pendingRequest.current && lastRequestKey.current !== null) flush();
      });
  }, [applyBudget, fail]);

  useEffect(() => {
    if (measurements.key !== presentationKey) return;
    pendingRequest.current = {
      preferredWidth: measurements.preferredWidth,
      minimumWidth: measurements.minimumWidth,
    };
    lastRequestKey.current = null;
    flush();
  }, [flush, measurements, presentationKey]);

  useEffect(() => {
    disposed.current = false;
    let configChanged = false;
    const cleanup: Array<() => void> = [];
    const subscribe = <T,>(name: string, callback: (payload: T) => void) => {
      return listen<T>(name, (event) => {
        if (!disposed.current) callback(event.payload);
      })
        .then((off) => {
          if (disposed.current) off();
          else cleanup.push(off);
        })
        .catch((cause) => fail("挂件事件监听失败", cause));
    };
    const registrations = [
      subscribe<WidgetLayoutBudget>("widget-layout-budget", (next) => {
        applyBudget(next);
        flush();
      }),
      subscribe<SysStatus>("sys-status-update", (next) => {
        setStatus(next);
        setLastSampleAt(Date.now());
      }),
      subscribe<WidgetConfig>("widget-config-changed", (next) => {
        configChanged = true;
        setConfig(next);
      }),
      subscribe("widget-layout-request", () => {
        void emit("widget-layout-report", reportRef.current).catch((cause) =>
          fail("挂件布局上报失败", cause),
        );
      }),
    ];
    const refresh = () => {
      flush();
      void invokeCommand("refresh_widget_position")
        .then(applyBudget)
        .catch((cause) => fail("挂件位置刷新失败", cause));
    };
    // Await listener registration before reading the initial snapshots.
    void Promise.all(registrations).then(() => {
      if (disposed.current) return;
      void invokeCommand("get_widget_config")
        .then((next) => {
          if (!disposed.current && !configChanged) setConfig(next);
        })
        .catch((cause) => fail("挂件配置读取失败", cause));
      refresh();
    });
    window.addEventListener("resize", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      disposed.current = true;
      cleanup.forEach((off) => off());
      if (measureFrame.current !== null) cancelAnimationFrame(measureFrame.current);
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [applyBudget, fail, flush]);

  const measure = useCallback(() => {
    if (measureFrame.current !== null) return;
    measureFrame.current = requestAnimationFrame(() => {
      measureFrame.current = null;
      if (disposed.current || !normalRow.current || !compactRow.current) return;
      const widths = (row: HTMLDivElement) =>
        [...row.children].map((node) => node.getBoundingClientRect().width);
      const normalWidths = widths(normalRow.current);
      const compactWidths = widths(compactRow.current);
      const lockedCompact = config.layout.mode === "compact";
      const minimumCompact = config.layout.mode !== "standard";
      const preferredWidth = Math.max(
        1,
        Math.ceil(
          enabled.length
            ? (lockedCompact ? compactRow.current : normalRow.current).getBoundingClientRect().width
            : 40 + 2 * (lockedCompact ? compactSpacing.padding : normalSpacing.padding),
        ),
      );
      const minimumWidth = Math.max(
        1,
        Math.ceil(
          ((minimumCompact ? compactWidths[0] : normalWidths[0]) ?? 40) +
            2 * (minimumCompact ? compactSpacing.padding : normalSpacing.padding),
        ),
      );
      const next = {
        preferredWidth,
        minimumWidth,
        normalWidths,
        compactWidths,
        key: presentationKey,
      };
      setMeasurements((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next,
      );
    });
  }, [presentationKey, config.layout.mode, normalSpacing.padding, compactSpacing.padding]);

  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure);
    [normalRow.current, compactRow.current].forEach((row) => {
      if (!row) return;
      observer.observe(row);
      [...row.children].forEach((node) => observer.observe(node));
    });
    measure();
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) measure();
    });
    return () => {
      cancelled = true;
      observer.disconnect();
      if (measureFrame.current !== null) cancelAnimationFrame(measureFrame.current);
      measureFrame.current = null;
    };
  }, [measure]);

  const responsive =
    measurements.key === presentationKey
      ? calculateWidgetResponsiveLayout(
          measurements.normalWidths,
          measurements.compactWidths,
          budget.allocatedWidth,
          12,
          config.layout,
        )
      : {
          compact: config.layout.mode === "compact",
          visibleCount: 0,
          hiddenCount: enabled.length,
          showOverflow: false,
        };
  const report: WidgetLayoutReport = {
    ...describeWidgetColumns(columns, budget.visible ? responsive.visibleCount : 0),
    revision: budget.revision,
    compact: responsive.compact,
    visible: budget.visible,
  };
  reportRef.current = report;
  useEffect(() => {
    void emit("widget-layout-report", reportRef.current).catch((cause) =>
      fail("挂件布局上报失败", cause),
    );
  }, [presentationKey, responsive.compact, responsive.visibleCount, budget.revision, fail]);

  return (
    <>
      <div
        className={`widget-container wm-row${responsive.compact ? " wm-compact" : ""}`}
        style={rowStyle(responsive.compact)}
        aria-hidden={!budget.visible}
        title={error ?? budget.error ?? undefined}
      >
        {columns.slice(0, responsive.visibleCount).map((column) => (
          <WidgetColumn
            key={column[0].kind}
            metrics={column}
            status={liveStatus}
            speedUnit={config.speed_unit}
            stale={freshness === "stale"}
          />
        ))}
        {responsive.showOverflow && (
          <span
            className="widget-overflow"
            title={`另有 ${report.hiddenKinds.length} 项指标因空间不足已收起`}
            aria-label={`另有 ${report.hiddenKinds.length} 项指标已收起`}
          >
            …
          </span>
        )}
        {!enabled.length && (
          <span className="widget-empty" role="status" aria-label="暂无可用挂件指标">
            —
          </span>
        )}
        {error && (
          <span className="widget-error" role="status" title={error}>
            !
          </span>
        )}
      </div>
      <div className="widget-measurements" aria-hidden="true">
        {[false, true].map((compact) => (
          <div
            key={String(compact)}
            ref={compact ? compactRow : normalRow}
            className={`widget-container widget-measure-row wm-row${compact ? " wm-compact" : ""}`}
            style={rowStyle(compact)}
          >
            {columns.map((column) => (
              <WidgetColumn
                key={column[0].kind}
                metrics={column}
                status={MEASUREMENT_STATUS}
                speedUnit={config.speed_unit}
              />
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(<TaskbarWidget />);
