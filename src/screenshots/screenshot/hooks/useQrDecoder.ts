import { useCallback, type MutableRefObject } from "react";
import type { QrDecodeResult } from "../api";
import { RequestGeneration } from "./requestGeneration";
import { runSelectionImageRequest } from "./selectionImageRequest";

interface UseQrDecoderOptions {
  exportPng: () => Promise<Uint8Array>;
  request: MutableRefObject<RequestGeneration>;
  onResult: (contents: QrDecodeResult["contents"]) => void;
  onError: (message: string) => void;
}

/** Keeps QR decoding scoped to the latest selection and releases abandoned image payloads. */
export function useQrDecoder({ exportPng, request, onResult, onError }: UseQrDecoderOptions) {
  const decode = useCallback(() => {
    const generation = request.current.next();
    void (async () => {
      try {
        if (!request.current.isCurrent(generation)) return;
        const result = await runSelectionImageRequest({
          request,
          generation,
          exportPng,
          execute: window.api.decodeQrSelection,
        });
        if (result) onResult(result.contents);
      } catch (error) {
        if (request.current.isCurrent(generation)) {
          onError(error instanceof Error ? error.message : "二维码识别失败");
        }
      }
    })();
  }, [exportPng, onError, onResult]);

  return { decode };
}
