import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { MAIN_EVENTS, errorMessage, keyVisualizerApi, presentationApi } from "./api/commands";
import type {
  KeyVisualizerConfig,
  KeyVisualizerInput,
  KeyVisualizerSession,
  PresentationStatus,
  PresentationLocks,
} from "./types";
import {
  appendKeyVisualizerEntry,
  keyVisualizerEntryOpacity,
  removeExpiredKeyVisualizerEntries,
  type KeyVisualizerEntry,
} from "./components/keyVisualizerEntries";
import "./key-visualizer.scss";

function KeyVisualizerWindow() {
  const [generation, setGeneration] = useState(0);
  const [config, setConfig] = useState<KeyVisualizerConfig | null>(null);
  const [entries, setEntries] = useState<KeyVisualizerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const session = useRef<KeyVisualizerSession | null>(null);
  const presentation = useRef<PresentationStatus | null>(null);
  const [locks, setLocks] = useState<PresentationLocks | null>(null);

  useEffect(() => {
    let disposed = false;
    const offs: (() => void)[] = [];
    const receiveSession = (next: KeyVisualizerSession) => {
      if (disposed || (session.current && next.generation < session.current.generation)) return;
      if (next.generation !== session.current?.generation || !next.config.enabled) {
        setEntries([]);
        setLocks(null);
      }
      session.current = next;
      setGeneration(next.generation);
      setConfig(next.config);
      setError(null);
    };
    const receiveLocks = (value: PresentationLocks) => {
      const status = presentation.current;
      if (
        !disposed &&
        status?.enabled &&
        !status.suspended &&
        status.config.lock_keys &&
        value.generation === status.generation
      )
        setLocks(value);
    };
    const receivePresentation = (next: PresentationStatus) => {
      if (disposed || (presentation.current && next.generation < presentation.current.generation))
        return;
      if (next.generation !== presentation.current?.generation || !next.enabled || next.suspended)
        setLocks(null);
      presentation.current = next;
      if (next.locks) receiveLocks(next.locks);
    };
    const subscribe = async <T,>(name: string, receive: (value: T) => void) => {
      const off = await listen<T>(name, ({ payload }) => receive(payload));
      if (disposed) off();
      else offs.push(off);
    };
    const start = async () => {
      await subscribe<KeyVisualizerSession>(MAIN_EVENTS.keyVisualizerSession, receiveSession);
      if (disposed) return;
      await subscribe<KeyVisualizerInput>(MAIN_EVENTS.keyVisualizerInput, (input) => {
        if (
          !disposed &&
          session.current?.config.enabled &&
          input.generation === session.current.generation
        ) {
          setEntries((current) => appendKeyVisualizerEntry(current, input));
        }
      });
      if (disposed) return;
      await subscribe<PresentationStatus>(MAIN_EVENTS.presentationStatus, receivePresentation);
      if (disposed) return;
      await subscribe<PresentationLocks>(MAIN_EVENTS.presentationLocks, receiveLocks);
      if (disposed) return;
      receiveSession(await keyVisualizerApi.session());
      receivePresentation(await presentationApi.status());
    };
    void start().catch((reason) => {
      if (!disposed) setError(errorMessage(reason));
    });
    return () => {
      disposed = true;
      offs.forEach((off) => off());
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setEntries((current) => removeExpiredKeyVisualizerEntries(current, Date.now()));
      setLocks((current) => (current && Date.now() - current.timestamp_ms < 2000 ? current : null));
    }, 150);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!config) return;
    let disposed = false;
    void keyVisualizerApi.ready(generation).catch((reason) => {
      if (!disposed) setError(errorMessage(reason));
    });
    return () => {
      disposed = true;
    };
  }, [config, generation]);

  if (error)
    return (
      <div className="key-visualizer-error">
        按键文本不可用
        <br />
        <small>{error}</small>
      </div>
    );
  if (!config) return <div className="key-visualizer-loading">正在准备…</div>;
  const now = Date.now();

  return (
    <main
      className="key-visualizer-surface"
      style={
        {
          "--key-font-size": `${config.font_size}px`,
          "--visualizer-scale": config.scale_percent / 100,
        } as React.CSSProperties
      }
    >
      {locks && Date.now() - locks.timestamp_ms < 2000 && (
        <div className="key-lock-status">
          <div>CapsLock {locks.caps ? "已开启" : "已关闭"}</div>
          <div>NumLock {locks.num ? "已开启" : "已关闭"}</div>
        </div>
      )}
      <div className="key-entry-list">
        {entries.map((entry) => (
          <div
            className="key-entry"
            data-category={entry.category}
            key={entry.id}
            style={{
              opacity: keyVisualizerEntryOpacity(config.text_opacity, entry.timestamp_ms, now),
            }}
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
  <React.StrictMode>
    <KeyVisualizerWindow />
  </React.StrictMode>,
);
