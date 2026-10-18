import { useEffect, useRef } from "react";
import type { Api } from "../api";
import type { FullScreenshot } from "../../../api/screenshotTypes";

interface Options {
  label: string;
  onCapture: (frame: FullScreenshot, isCurrent: () => boolean) => Promise<void>;
  onError: (message: string) => void;
}
export function useCaptureBootstrap(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => connectCaptureSurface(window.api, () => latest.current), [options.label]);
}

/** Start listening before native readiness; disposal invalidates all pending reads. */
export function connectCaptureSurface(
  api: Pick<
    Api,
    | "getFullScreenshot"
    | "reportCaptureFailed"
    | "reportCaptureRendered"
    | "onCaptureReady"
    | "overlayReady"
  >,
  options: () => Options,
) {
  const label = options().label;
  let disposed = false;
  let revision = 0;
  let loadedGeneration = 0;
  let off: (() => void) | undefined;
  const report = async (error: unknown, generation?: number) => {
    const message = error instanceof Error ? error.message : String(error);
    options().onError(message);
    try {
      await api.reportCaptureFailed(label, message, generation);
    } catch (failure) {
      options().onError(`截图错误上报失败：${String(failure)}；启动超时后可在主窗口重试`);
    }
  };
  const load = async () => {
    const request = ++revision;
    const isCurrent = () => !disposed && request === revision;
    let generation: number | undefined;
    try {
      const frame = await api.getFullScreenshot(label);
      if (!isCurrent() || frame.overlayLabel !== label || frame.generation === loadedGeneration)
        return;
      generation = frame.generation;
      await options().onCapture(frame, isCurrent);
      if (!isCurrent()) return;
      const shown = await api.reportCaptureRendered(generation, label);
      if (!shown) throw new Error("截图浮层未能显示");
      if (isCurrent()) loadedGeneration = generation;
    } catch (error) {
      if (isCurrent()) await report(error, generation);
    }
  };
  void (async () => {
    // A native ready announcement must never overtake its event listener.
    const cleanup = await api.onCaptureReady((target) => {
      if (!disposed && target === label) void load();
    });
    if (disposed) {
      cleanup();
      return;
    }
    off = cleanup;
    await api.overlayReady(label);
  })().catch((error) => {
    if (!disposed) void report(error);
  });
  return () => {
    disposed = true;
    revision += 1;
    off?.();
  };
}
