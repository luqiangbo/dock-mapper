import { useCallback, useRef, useState } from "react";
import type { OcrResult } from "../api";
import { RequestGeneration } from "./requestGeneration";
import { runSelectionImageRequest } from "./selectionImageRequest";

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
}

export function useOcr({ enabled, exportPng, engineFailed }: Options) {
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
        const startedAt = performance.now();
        const result = await runSelectionImageRequest({
          request,
          generation,
          exportPng,
          execute: window.api.recognizeSelection,
        });
        if (!result) return;
        setPanel({
          result,
          error: null,
          pending: false,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        if (!request.current.isCurrent(generation)) return;
        const message = error instanceof Error ? error.message : engineFailed;
        setPanel({ result: null, error: message, pending: false, elapsedMs: null });
      } finally {
        if (request.current.isCurrent(generation)) setRunning(false);
      }
    })();
  }, [enabled, engineFailed, exportPng, running]);

  return { panel, running, recognize, dismiss };
}
