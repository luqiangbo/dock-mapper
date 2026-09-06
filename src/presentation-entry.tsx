import { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MAIN_EVENTS, presentationApi, errorMessage } from "./api/commands";
import type { PresentationMouse, PresentationStatus } from "./types";
import {
  acceptsPresentationEvent,
  activeMouseEffects,
  localMousePoint,
} from "./components/presentationEffects";
import "./presentation.scss";

function PresentationWindow() {
  const current = useRef<PresentationStatus | null>(null);
  const [status, setStatus] = useState<PresentationStatus | null>(null);
  const [pointer, setPointer] = useState<PresentationMouse | null>(null);
  const [effects, setEffects] = useState<PresentationMouse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const label = getCurrentWindow().label;

  useEffect(() => {
    let disposed = false;
    const offs: (() => void)[] = [];
    const receive = (next: PresentationStatus) => {
      if (disposed || (current.current && next.generation < current.current.generation)) return;
      if (next.generation !== current.current?.generation || !next.enabled || next.suspended) {
        setPointer(null);
        setEffects([]);
      }
      current.current = next;
      setStatus(next);
    };
    const start = async () => {
      const offStatus = await listen<PresentationStatus>(
        MAIN_EVENTS.presentationStatus,
        ({ payload }) => receive(payload),
      );
      if (disposed) {
        offStatus();
        return;
      }
      offs.push(offStatus);
      const offMouse = await listen<PresentationMouse>(
        MAIN_EVENTS.presentationMouse,
        ({ payload }) => {
          if (!acceptsPresentationEvent(current.current, payload.generation)) return;
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
      receive(await presentationApi.ready());
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
  if (error) return <div className="presentation-error">演示效果不可用：{error}</div>;
  if (!screen || !status?.enabled || status.suspended) return null;
  const point = pointer && localMousePoint(screen, pointer);
  return (
    <main className="presentation-surface" aria-hidden="true">
      {point && status.config.highlight && (
        <div className="presentation-halo" style={{ left: point.x, top: point.y }} />
      )}
      {effects.map((effect) => {
        const position = localMousePoint(screen, effect);
        return (
          <div
            key={`${effect.timestamp_ms}-${effect.kind}`}
            className={`presentation-ring ${effect.kind}`}
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

ReactDOM.createRoot(document.getElementById("root")!).render(<PresentationWindow />);
