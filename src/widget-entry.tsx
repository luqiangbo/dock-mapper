import React, { useEffect, useState, useRef, useCallback } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "./widget.css";

interface SysStatus {
  upload_speed: number;
  download_speed: number;
  memory_usage: number;
}

// ─── Format speed into { numeric, unit } for stable column layout ─────
function FormatSpeedParts(bytesPerSec: number): { num: string; unit: string } {
  if (bytesPerSec < 1024) return { num: bytesPerSec.toFixed(0), unit: "B/s" };
  const kb = bytesPerSec / 1024;
  if (kb < 1024) return { num: kb.toFixed(1), unit: "K/s" };
  return { num: (kb / 1024).toFixed(1), unit: "M/s" };
}

function memColor(usage: number): string {
  if (usage < 70) return "#00cc66";
  if (usage < 90) return "#ff9900";
  return "#ff3333";
}

// ─────────────────────────────────────────────────────────────────────────
//  Scheme 1 — Capsule Indicator
// ─────────────────────────────────────────────────────────────────────────
function CapsuleIndicator({ usage }: { usage: number }) {
  const color = memColor(usage);
  const pct = usage.toFixed(0);
  let animClass = "";
  if (usage >= 70 && usage < 90) animClass = "led-breathe";
  else if (usage >= 90) animClass = "led-flash";

  return (
    <div className="capsule-indicator" style={{ borderColor: `${color}26` }}>
      <span
        className={`led-dot ${animClass}`}
        style={{ "--led-color": color, color } as React.CSSProperties}
      />
      <span className="capsule-label">{pct}%</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  Scheme 2 — Ring & Core
// ─────────────────────────────────────────────────────────────────────────
function RingIndicator({ usage }: { usage: number }) {
  const color = memColor(usage);
  const pct = usage.toFixed(0);
  const r = 9.5;
  const circ = 2 * Math.PI * r;
  const dash = (usage / 100) * circ;

  return (
    <div className="ring-indicator">
      <svg width={24} height={24} viewBox="0 0 24 24">
        <circle
          cx={12}
          cy={12}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={2.5}
        />
        <circle
          cx={12}
          cy={12}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 12 12)"
          style={{ transition: "stroke-dasharray 0.3s ease, stroke 0.3s ease" }}
        />
      </svg>
      <span className="ring-core">{pct}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  Scheme 3 — Dashboard Gauge
// ─────────────────────────────────────────────────────────────────────────
function GaugeIndicator({ usage }: { usage: number }) {
  const pct = usage.toFixed(0);
  const filledCount = Math.round(usage / 20);

  return (
    <div className="gauge-indicator">
      <div className="gauge-blocks">
        {[0, 1, 2, 3, 4].map((i) => {
          const lit = i < filledCount;
          return (
            <span
              key={i}
              className={`gauge-block${lit ? " lit" : ""}`}
              style={
                lit ? { backgroundColor: memColor((i + 1) * 20) } : undefined
              }
            />
          );
        })}
      </div>
      <span className="gauge-label">{pct}%</span>
    </div>
  );
}

function MemIndicator({ usage, scheme }: { usage: number; scheme: number }) {
  switch (scheme) {
    case 1:
      return <CapsuleIndicator usage={usage} />;
    case 2:
      return <RingIndicator usage={usage} />;
    case 3:
      return <GaugeIndicator usage={usage} />;
    default:
      return <CapsuleIndicator usage={usage} />;
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  TaskbarWidget
// ─────────────────────────────────────────────────────────────────────────
function TaskbarWidget() {
  const [status, setStatus] = useState<SysStatus>({
    upload_speed: 0,
    download_speed: 0,
    memory_usage: 0,
  });
  const [scheme, setScheme] = useState<number>(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Sync real content width to backend ─────────────────────────────
  const syncWidth = useCallback(() => {
    if (!containerRef.current) return;
    const w = containerRef.current.scrollWidth;
    invoke("sync_widget_dynamic_width", { width: w }).catch((err) =>
      console.error("sync_widget_dynamic_width failed:", err),
    );
  }, []);

  useEffect(() => {
    // 1. Load config
    invoke<{ memory_scheme: number }>("get_widget_config")
      .then((cfg) => setScheme(cfg.memory_scheme))
      .catch((err) => console.error("Failed to load widget config:", err));

    // 2. Listen for live sys-status
    const unlistenStatus = listen<SysStatus>("sys-status-update", (event) => {
      setStatus(event.payload);
    });

    // 3. Listen for scheme changes
    const unlistenScheme = listen<number>("scheme-changed", (event) => {
      setScheme(event.payload);
    });

    // 4. ResizeObserver — sync width whenever content box changes
    let observer: ResizeObserver | null = null;
    if (containerRef.current) {
      observer = new ResizeObserver(() => syncWidth());
      observer.observe(containerRef.current);
    }

    // 5. Initial positioning + periodic refresh
    syncWidth();
    invoke("refresh_widget_position").catch((err) =>
      console.error("Failed to refresh widget position:", err),
    );
    const positionInterval = setInterval(() => {
      invoke("refresh_widget_position").catch((err) =>
        console.error("Failed to refresh widget position:", err),
      );
    }, 3000);

    return () => {
      unlistenStatus.then((f) => f());
      unlistenScheme.then((f) => f());
      if (observer) observer.disconnect();
      clearInterval(positionInterval);
    };
  }, [syncWidth]);

  const up = FormatSpeedParts(status.upload_speed);
  const down = FormatSpeedParts(status.download_speed);

  return (
    <div className="widget-container" ref={containerRef}>
      {/* ── Network speed ───────────────────────────────────────────── */}
      <div className="net-speed">
        <div className="speed-row">
          <span className="up-arrow">▲</span>
          <span className="speed-value">{up.num}</span>
          <span className="speed-unit">{up.unit}</span>
        </div>
        <div className="speed-row">
          <span className="down-arrow">▼</span>
          <span className="speed-value">{down.num}</span>
          <span className="speed-unit">{down.unit}</span>
        </div>
      </div>

      {/* Separator */}
      <span style={{ color: "#555" }}>|</span>

      {/* ── Memory ──────────────────────────────────────────────────── */}
      <MemIndicator usage={status.memory_usage} scheme={scheme} />
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<TaskbarWidget />);
