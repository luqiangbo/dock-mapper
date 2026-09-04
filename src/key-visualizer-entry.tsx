import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { MAIN_EVENTS, errorMessage, keyVisualizerApi } from "./api/commands";
import type { KeyVisualizerConfig, KeyVisualizerInput } from "./types";
import {
  appendKeyVisualizerEntry,
  keyVisualizerEntryOpacity,
  removeExpiredKeyVisualizerEntries,
  type KeyVisualizerEntry,
} from "./components/keyVisualizerEntries";
import "./key-visualizer.scss";

function KeyVisualizerWindow() {
  const [config, setConfig] = useState<KeyVisualizerConfig | null>(null);
  const [entries, setEntries] = useState<KeyVisualizerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let configOff: (() => void) | undefined;
    let inputOff: (() => void) | undefined;
    void keyVisualizerApi.config().then((value) => {
      if (!disposed) setConfig(value);
    }).catch((reason) => {
      if (!disposed) setError(errorMessage(reason));
    });
    void listen<KeyVisualizerConfig>(MAIN_EVENTS.keyVisualizerConfigChanged, ({ payload }) => {
      setConfig(payload);
      setError(null);
    }).then((off) => disposed ? off() : (configOff = off));
    void listen<KeyVisualizerInput>(MAIN_EVENTS.keyVisualizerInput, ({ payload }) => {
      setEntries((current) => appendKeyVisualizerEntry(current, payload));
    }).then((off) => disposed ? off() : (inputOff = off));
    return () => {
      disposed = true;
      configOff?.();
      inputOff?.();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setEntries((current) => removeExpiredKeyVisualizerEntries(current, Date.now()));
    }, 150);
    return () => window.clearInterval(timer);
  }, []);

  if (error) return <div className="key-visualizer-error">按键文本不可用<br /><small>{error}</small></div>;
  if (!config) return <div className="key-visualizer-loading">正在准备…</div>;
  const now = Date.now();

  return (
    <main
      className="key-visualizer-surface"
      style={{
        "--key-font-size": `${config.font_size}px`,
        "--visualizer-scale": config.scale_percent / 100,
      } as React.CSSProperties}
    >
      <div className="key-entry-list">
        {entries.map((entry) => (
          <div
            className="key-entry"
            data-category={entry.category}
            key={entry.id}
            style={{ opacity: keyVisualizerEntryOpacity(config.text_opacity, entry.timestamp_ms, now) }}
          >
            <span>{entry.label}</span>
            {entry.repeat > 1 && <strong>×{entry.repeat}</strong>}
          </div>
        ))}
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><KeyVisualizerWindow /></React.StrictMode>,
);
