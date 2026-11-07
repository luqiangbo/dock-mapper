import { useCallback, useRef, type MutableRefObject } from "react";
import type { QrDecodeResult } from "../api";
import { RequestGeneration } from "./requestGeneration";
import { runSelectionImageRequest } from "./selectionImageRequest";

interface UseQrDecoderOptions {
  exportPng: () => Promise<Uint8Array>;
  request: MutableRefObject<RequestGeneration>;
  onResult: (result: QrDecodeResult) => void;
  onError: (message: string) => void;
  onStart: () => void;
}

/** Keeps QR decoding scoped to the latest selection and releases abandoned image payloads. */
export function useQrDecoder({
  exportPng,
  request,
  onResult,
  onError,
  onStart,
}: UseQrDecoderOptions) {
  const active = useRef<number | null>(null);
  const decode = useCallback(() => {
    if (active.current !== null && request.current.isCurrent(active.current)) return;
    const generation = request.current.next();
    active.current = generation;
    onStart();
    void (async () => {
      try {
        if (!request.current.isCurrent(generation)) return;
        const result = await runSelectionImageRequest({
          request,
          generation,
          exportPng,
          execute: window.api.decodeQrSelection,
        });
        if (result) onResult(result);
      } catch (error) {
        if (request.current.isCurrent(generation)) {
          onError(error instanceof Error ? error.message : "二维码识别失败");
        }
      } finally {
        if (active.current === generation) active.current = null;
      }
    })();
  }, [exportPng, onError, onResult, onStart, request]);

  return { decode };
}
