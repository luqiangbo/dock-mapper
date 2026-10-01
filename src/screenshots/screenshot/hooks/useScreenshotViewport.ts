import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { screenshotViewport } from "../components/screenshotViewport";

/** One exact transform drives both the native annotation scene and visible bitmap. */
export function useScreenshotViewport(
  api: ExcalidrawImperativeAPI | null,
  base: HTMLCanvasElement | null,
  display: HTMLCanvasElement | null,
  captureKey: string,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const lastTransform = useRef("");
  const [revision, setRevision] = useState(0);
  const alignViewport = useCallback(() => {
    const root = rootRef.current;
    if (!api || !base || !root || !display) return;
    const rect = root.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const view = screenshotViewport(base.width, base.height, rect);
    Object.assign(display.style, {
      position: "absolute",
      left: `${view.insetX}px`,
      top: `${view.insetY}px`,
      width: `${base.width * view.zoom}px`,
      height: `${base.height * view.zoom}px`,
    });
    const key = [
      captureKey,
      base.width,
      base.height,
      rect.left,
      rect.top,
      rect.width,
      rect.height,
    ].join(":");
    if (lastTransform.current !== key) {
      lastTransform.current = key;
      setRevision((value) => value + 1);
    }
    const state = api.getAppState();
    if (
      state.zoom.value === view.zoom &&
      state.scrollX === view.scrollX &&
      state.scrollY === view.scrollY &&
      state.width === rect.width &&
      state.height === rect.height &&
      state.offsetLeft === rect.left &&
      state.offsetTop === rect.top
    )
      return;
    api.updateScene({
      appState: {
        zoom: { value: view.zoom },
        scrollX: view.scrollX,
        scrollY: view.scrollY,
        width: rect.width,
        height: rect.height,
        offsetLeft: rect.left,
        offsetTop: rect.top,
      } as never,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [api, base, display, captureKey]);
  const scheduleAlignment = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      alignViewport();
    });
  }, [alignViewport]);
  useLayoutEffect(() => {
    alignViewport();
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(scheduleAlignment);
    observer.observe(root);
    window.addEventListener("resize", scheduleAlignment);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleAlignment);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [alignViewport, scheduleAlignment]);
  return { rootRef, alignViewport, scheduleAlignment, revision };
}
