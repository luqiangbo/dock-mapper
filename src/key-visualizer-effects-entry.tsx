import { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MAIN_EVENTS, keyVisualizerApi, errorMessage } from "./api/commands";
import type { KeyVisualizerEffectsStatus, KeyVisualizerMouse } from "./types";
import {
  acceptsKeyVisualizerEffect,
  activeMouseEffects,
  localMousePoint,
} from "./components/keyVisualizerEffects";
import "./key-visualizer-effects.scss";

function KeyVisualizerEffectsWindow() {
  const current = useRef<KeyVisualizerEffectsStatus | null>(null);
  const [status, setStatus] = useState<KeyVisualizerEffectsStatus | null>(null);
  const [pointer, setPointer] = useState<KeyVisualizerMouse | null>(null);
  const [effects, setEffects] = useState<KeyVisualizerMouse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const label = getCurrentWindow().label;

  useEffect(() => {
    let disposed = false;
    const offs: (() => void)[] = [];
    const receive = (next: KeyVisualizerEffectsStatus) => {
      if (disposed || (current.current && next.generation < current.current.generation)) return;
      if (next.generation !== current.current?.generation || !next.enabled || next.suspended) {
        setPointer(null);
        setEffects([]);
      }
      current.current = next;
      setStatus(next);
    };
    const start = async () => {
      const offStatus = await listen<KeyVisualizerEffectsStatus>(
        MAIN_EVENTS.keyVisualizerEffectsStatus,
        ({ payload }) => receive(payload),
      );
      if (disposed) {
        offStatus();
        return;
      }
      offs.push(offStatus);
      const offMouse = await listen<KeyVisualizerMouse>(
        MAIN_EVENTS.keyVisualizerMouse,
        ({ payload }) => {
          if (!acceptsKeyVisualizerEffect(current.current, payload.generation)) return;
          if (payload.kind === "move") setPointer(payload);
          else
            setEffects((values) => activeMouseEffects([...values, payload], Date.now()).slice(-32));
        },
      );
      if (disposed) {
        offMouse();
        return;
      }
      offs.push(offMouse);
      receive(await keyVisualizerApi.effectsReady());
    };
    void start().catch((reason) => {
      if (!disposed) setError(errorMessage(reason));
    });
    const timer = window.setInterval(
      () => setEffects((values) => activeMouseEffects(values, Date.now())),
      100,
    );
    return () => {
      disposed = true;
      offs.forEach((off) => off());
      window.clearInterval(timer);
    };
  }, []);

  const screen = status?.screens.find((value) => value.label === label);
  if (error) return <div className="key-visualizer-effects-error">按键展示效果不可用：{error}</div>;
  if (!screen || !status?.enabled || status.suspended) return null;
  const point = pointer && localMousePoint(screen, pointer);
  return (
    <main className="key-visualizer-effects-surface" aria-hidden="true">
      {point && status.config.highlight && (
        <div className="key-visualizer-effects-halo" style={{ left: point.x, top: point.y }} />
      )}
      {effects.map((effect) => {
        const position = localMousePoint(screen, effect);
        return (
          <div
            key={`${effect.timestamp_ms}-${effect.kind}`}
            className={`key-visualizer-effects-ring ${effect.kind}`}
            style={{
              left: position.x,
              top: position.y,
            }}
          />
        );
      })}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<KeyVisualizerEffectsWindow />);
