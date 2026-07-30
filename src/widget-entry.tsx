import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { MemoryScheme, SysStatus, WidgetConfig } from "./types";
import { formatSpeedParts } from "./utils/format";
import "./widget.css";

function memoryColor(usage: number): string {
  if (usage < 70) return "#35c985";
  if (usage < 90) return "#f2a33a";
  return "#ff5d67";
}

function CapsuleIndicator({ usage }: { usage: number }) {
  const color = memoryColor(usage);
  const urgency = usage >= 90 ? " led-flash" : usage >= 70 ? " led-breathe" : "";
  return (
    <div className="capsule-indicator">
      <span
        className={`led-dot${urgency}`}
        style={{ "--led-color": color } as CSSProperties}
      />
      <span className="capsule-label" aria-label={`内存占用 ${usage.toFixed(0)}%`}>
        RAM {usage.toFixed(0)}%
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
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <circle className="ring-track" cx="12" cy="12" r={radius} fill="none" strokeWidth="2.5" />
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke={memoryColor(usage)}
          strokeWidth="2.5"
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
  const filled = Math.round(usage / 20);
  return (
    <div className="gauge-indicator" aria-label={`内存占用 ${usage.toFixed(0)}%`}>
      <div className="gauge-blocks" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <span
            key={index}
            className="gauge-block"
            style={index < filled ? { backgroundColor: memoryColor((index + 1) * 20) } : undefined}
          />
        ))}
      </div>
      <span className="gauge-label">{usage.toFixed(0)}%</span>
    </div>
  );
}

function MemoryIndicator({ usage, scheme }: { usage: number; scheme: MemoryScheme }) {
  if (scheme === "ring") return <RingIndicator usage={usage} />;
  if (scheme === "gauge") return <GaugeIndicator usage={usage} />;
  return <CapsuleIndicator usage={usage} />;
}

function TaskbarWidget() {
  const [status, setStatus] = useState<SysStatus>({
    upload_speed: 0,
    download_speed: 0,
    memory_usage: 0,
  });
  const [scheme, setScheme] = useState<MemoryScheme>("capsule");
  const containerRef = useRef<HTMLDivElement>(null);

  const syncWidth = useCallback(() => {
    if (containerRef.current) {
      void invoke("sync_widget_dynamic_width", {
        width: containerRef.current.scrollWidth,
      });
    }
  }, []);

  useEffect(() => {
    void invoke<WidgetConfig>("get_widget_config")
      .then((config) => setScheme(config.memory_scheme))
      .catch((error) => console.error("读取挂件配置失败", error));

    const statusListener = listen<SysStatus>("sys-status-update", (event) => {
      setStatus(event.payload);
    });
    const configListener = listen<WidgetConfig>("widget-config-changed", (event) => {
      setScheme(event.payload.memory_scheme);
    });

    const observer = new ResizeObserver(syncWidth);
    if (containerRef.current) observer.observe(containerRef.current);
    syncWidth();
    void invoke("refresh_widget_position");
    const positionTimer = window.setInterval(() => void invoke("refresh_widget_position"), 3000);

    return () => {
      void statusListener.then((unlisten) => unlisten());
      void configListener.then((unlisten) => unlisten());
      observer.disconnect();
      window.clearInterval(positionTimer);
    };
  }, [syncWidth]);

  const upload = formatSpeedParts(status.upload_speed);
  const download = formatSpeedParts(status.download_speed);

  return (
    <div className="widget-container" ref={containerRef}>
      <div className="net-speed" aria-label="实时网速">
        <div className="speed-row">
          <span className="up-arrow" aria-hidden="true">↑</span>
          <span className="speed-value">{upload.value}</span>
          <span className="speed-unit">{upload.unit}</span>
        </div>
        <div className="speed-row">
          <span className="down-arrow" aria-hidden="true">↓</span>
          <span className="speed-value">{download.value}</span>
          <span className="speed-unit">{download.unit}</span>
        </div>
      </div>
      <span className="separator" aria-hidden="true" />
      <MemoryIndicator usage={status.memory_usage} scheme={scheme} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<TaskbarWidget />);
