import { useEffect, useRef } from "react";
import { invokeCommand } from "../../../api/ipc";
import type { WindowCandidate } from "../../../api/screenshotTypes";
import { findWindowCandidate } from "../components/windowCandidates";
import type { CaptureExperience } from "../components/captureExperience";

export function useElementCandidates(options: {
  enabled: boolean;
  generation: number;
  mode: CaptureExperience["detection"];
  windows: WindowCandidate[];
  onCandidate: (candidate: WindowCandidate | undefined) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const cached = useRef<{ x: number; y: number; index: number; items: WindowCandidate[] } | null>(
    null,
  );
  useEffect(() => {
    let timer = 0,
      revision = 0,
      disposed = false;
    cached.current = null;
    const move = (event: PointerEvent) => {
      if (!latest.current.enabled || latest.current.mode !== "elements" || event.buttons) return;
      const x = event.clientX,
        y = event.clientY;
      const request = ++revision;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void invokeCommand("query_capture_elements", {
          generation: latest.current.generation,
          x,
          y,
        })
          .then((items) => {
            if (disposed || revision !== request || !latest.current.enabled) return;
            cached.current = { x, y, index: 0, items };
            latest.current.onCandidate(items[0]);
          })
          .catch(() => {
            if (!disposed && revision === request)
              latest.current.onCandidate(findWindowCandidate(latest.current.windows, x, y));
          });
      }, 90);
    };
    const wheel = (event: WheelEvent) => {
      if (
        !latest.current.enabled ||
        latest.current.mode !== "elements" ||
        !cached.current?.items.length
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const value = cached.current;
      value.index = Math.max(
        0,
        Math.min(value.items.length - 1, value.index + (event.deltaY > 0 ? 1 : -1)),
      );
      latest.current.onCandidate(value.items[value.index]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("wheel", wheel, { capture: true, passive: false });
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("wheel", wheel, true);
    };
  }, [options.generation, options.mode]);
  return (x: number, y: number) => {
    if (options.mode === "manual") return undefined;
    const value = cached.current;
    if (options.mode === "elements" && value && Math.hypot(value.x - x, value.y - y) <= 2)
      return value.items[value.index];
    return findWindowCandidate(options.windows, x, y);
  };
}
