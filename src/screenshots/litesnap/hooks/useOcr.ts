import { useCallback, useRef, useState } from "react";
import type { OcrResult } from "../api";
import { RequestGeneration } from "./requestGeneration";

export interface OcrPanelState {
  result: OcrResult | null;
  error: string | null;
  pending: boolean;
  elapsedMs: number | null;
}

const EMPTY: OcrPanelState = { result: null, error: null, pending: false, elapsedMs: null };

interface Options {
  enabled: boolean;
  exportPng: () => Promise<Uint8Array>;
  engineFailed: string;
  exportFailed: string;
  onError: (message: string) => void;
}

export function useOcr({ enabled, exportPng, engineFailed, exportFailed, onError }: Options) {
  const request = useRef(new RequestGeneration());
  const [panel, setPanel] = useState<OcrPanelState>(EMPTY);
  const [running, setRunning] = useState(false);

  const dismiss = useCallback(() => {
    request.current.cancel();
    setRunning(false);
    setPanel(EMPTY);
  }, []);

  const recognize = useCallback(() => {
    if (!enabled || running) return;
    const generation = request.current.next();
    setPanel({ result: null, error: null, pending: true, elapsedMs: null });
    setRunning(true);
    void (async () => {
      try {
        const png = await exportPng();
        const startedAt = performance.now();
        const imageId = await window.api.uploadImage(png);
        const result = await window.api.recognizeSelection(imageId);
        if (!request.current.isCurrent(generation)) return;
        setPanel({
          result,
          error: null,
          pending: false,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        if (!request.current.isCurrent(generation)) return;
        const message = error instanceof Error ? error.message : engineFailed;
        onError(error instanceof Error ? error.message : exportFailed);
        setPanel({ result: null, error: message, pending: false, elapsedMs: null });
      } finally {
        if (request.current.isCurrent(generation)) setRunning(false);
      }
    })();
  }, [enabled, engineFailed, exportFailed, exportPng, onError, running]);

  return { panel, running, recognize, dismiss };
}
