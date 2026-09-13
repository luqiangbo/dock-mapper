import { useCallback, useEffect, useRef, useState, type WheelEvent as ReactWheelEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invokeCommand } from "../../../api/ipc";
import type {
  PinWindowGeometry,
  PinWindowGeometryRequest,
} from "../../../api/screenshotTypes";

interface Anchor {
  ratioX: number;
  ratioY: number;
  screenX: number;
  screenY: number;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

export function zoomGeometryAtAnchor(
  baseWidth: number,
  baseHeight: number,
  scale: number,
  anchor: Anchor,
  sequence: number,
): PinWindowGeometryRequest {
  const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
  const width = Math.max(1, Math.round(baseWidth * nextScale));
  const height = Math.max(1, Math.round(baseHeight * nextScale));
  return {
    x: anchor.screenX - width * anchor.ratioX,
    y: anchor.screenY - height * anchor.ratioY,
    width,
    height,
    scale: nextScale,
    sequence,
  };
}

export function usePinZoomController(pinId: string, enabled = true): {
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  zoomError: string;
} {
  const [zoomError, setZoomError] = useState("");
  const geometry = useRef<PinWindowGeometry | null>(null);
  const baseSize = useRef({ width: 1, height: 1 });
  const targetScale = useRef(1);
  const sequence = useRef(0);
  const pending = useRef<PinWindowGeometryRequest | null>(null);
  const inFlight = useRef(false);
  const frame = useRef<number | null>(null);
  const disposed = useRef(false);
  const errorTimer = useRef<number | null>(null);

  const reportError = useCallback((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    setZoomError(`贴图缩放失败：${detail}`);
    if (errorTimer.current !== null) window.clearTimeout(errorTimer.current);
    errorTimer.current = window.setTimeout(() => setZoomError(""), 1800);
  }, []);

  const flush = useCallback(() => {
    frame.current = null;
    if (disposed.current || inFlight.current || !pending.current) return;
    const request = pending.current;
    pending.current = null;
    inFlight.current = true;
    void invokeCommand("set_pin_window_geometry", { id: pinId, request })
      .then((applied) => {
        if (disposed.current || applied.sequence < sequence.current) return;
        geometry.current = applied;
      })
      .catch(reportError)
      .finally(() => {
        inFlight.current = false;
        if (!disposed.current && pending.current && frame.current === null)
          frame.current = requestAnimationFrame(flush);
      });
  }, [pinId, reportError]);

  useEffect(() => {
    disposed.current = false;
    const currentWindow = getCurrentWindow();
    const unlisteners: Array<() => void> = [];
    void invokeCommand("get_pin_window_geometry", { id: pinId })
      .then((initial) => {
        if (disposed.current) return;
        geometry.current = initial;
        baseSize.current = {
          width: initial.width / Math.max(0.01, initial.scale),
          height: initial.height / Math.max(0.01, initial.scale),
        };
        targetScale.current = initial.scale;
        sequence.current = initial.sequence;
      })
      .catch(reportError);
    void currentWindow.onMoved(({ payload }) => {
      if (!geometry.current || frame.current !== null || inFlight.current || pending.current) return;
      geometry.current = { ...geometry.current, x: payload.x, y: payload.y };
    }).then((unlisten) => {
      if (disposed.current) unlisten();
      else unlisteners.push(unlisten);
    });
    void currentWindow.onResized(({ payload }) => {
      if (!geometry.current || frame.current !== null || inFlight.current || pending.current) return;
      const scale = payload.width / Math.max(1, baseSize.current.width);
      geometry.current = { ...geometry.current, width: payload.width, height: payload.height, scale };
      targetScale.current = scale;
    }).then((unlisten) => {
      if (disposed.current) unlisten();
      else unlisteners.push(unlisten);
    });
    return () => {
      disposed.current = true;
      unlisteners.forEach((unlisten) => unlisten());
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (errorTimer.current !== null) window.clearTimeout(errorTimer.current);
      frame.current = null;
      pending.current = null;
    };
  }, [pinId, reportError]);

  useEffect(() => {
    if (enabled) return;
    pending.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, [enabled]);

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!enabled) return;
      event.preventDefault();
      const current = geometry.current;
      if (!current) {
        reportError("窗口位置尚未就绪，请稍后重试");
        return;
      }
      const bounds = event.currentTarget.getBoundingClientRect();
      const ratioX = Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
      const ratioY = Math.min(1, Math.max(0, (event.clientY - bounds.top) / Math.max(1, bounds.height)));
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, bounds.height) : 1);
      const nextScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, targetScale.current * Math.exp(-delta * 0.0015)),
      );
      targetScale.current = nextScale;
      const nextAnchor = {
        ratioX,
        ratioY,
        screenX: current.x + current.width * ratioX,
        screenY: current.y + current.height * ratioY,
      };
      sequence.current += 1;
      pending.current = zoomGeometryAtAnchor(
        baseSize.current.width,
        baseSize.current.height,
        nextScale,
        nextAnchor,
        sequence.current,
      );
      geometry.current = { ...pending.current };
      if (!inFlight.current && frame.current === null)
        frame.current = requestAnimationFrame(flush);
    },
    [enabled, flush, reportError],
  );

  return { onWheel, zoomError };
}
