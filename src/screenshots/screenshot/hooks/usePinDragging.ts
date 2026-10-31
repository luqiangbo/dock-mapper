import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PointerEvent as ReactPointerEvent } from "react";
import { exceedsDragThreshold } from "../components/selectionDrag";

export function usePinDragging(enabled: boolean, onError: (error: string) => void) {
  const pending = useRef<{ id: number; x: number; y: number; target: HTMLDivElement } | null>(null);
  const suppressUntil = useRef(0),
    active = useRef(true);
  const cancel = () => {
    const current = pending.current;
    pending.current = null;
    if (current?.target.hasPointerCapture(current.id))
      current.target.releasePointerCapture(current.id);
  };
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      cancel();
    };
  }, []);
  useEffect(() => {
    if (!enabled) cancel();
  }, [enabled]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("pointerup", cancel);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pointerup", cancel);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
  }, []);
  return {
    down: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (
        !enabled ||
        event.button !== 0 ||
        event.detail > 1 ||
        (event.target as Element).closest(
          "button,.pin-menu,.pin-operation-feedback,.pin-load-error",
        )
      )
        return;
      if (!event.altKey && (event.target as Element).closest("[data-pin-ocr]")) return;
      pending.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        target: event.currentTarget,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    move: (event: ReactPointerEvent<HTMLDivElement>) => {
      const start = pending.current;
      if (!start || start.id !== event.pointerId || !(event.buttons & 1)) return;
      if (!exceedsDragThreshold(event.clientX - start.x, event.clientY - start.y)) return;
      cancel();
      suppressUntil.current = performance.now() + 600;
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      void getCurrentWindow()
        .startDragging()
        .then(() => {
          suppressUntil.current = performance.now() + 600;
        })
        .catch((error) => {
          if (active.current) onError("移动贴图失败，请重试拖动：" + String(error));
        });
    },
    suppressDoubleClick: () => performance.now() < suppressUntil.current,
  };
}
