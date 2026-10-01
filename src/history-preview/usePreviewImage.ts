import { useEffect, useState } from "react";
import { historyApi, errorMessage } from "../api/commands";
import type { HistoryPreviewSession } from "../api/ipc";
import type { Size } from "./viewGeometry";
import { startImageRequest } from "./imageRequest";

export interface PreviewImage {
  url: string;
  size: Size;
  generation: number;
}
export function usePreviewImage(session: HistoryPreviewSession | null) {
  const [image, setImage] = useState<PreviewImage | null>(null);
  const [error, setError] = useState<{ generation: number; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setImage(null);
    setError(null);
    if (!session) return;
    const request = startImageRequest(
      {
        read: () => historyApi.image(session.id),
        createUrl: (bytes) => URL.createObjectURL(new Blob([bytes], { type: "image/png" })),
        revokeUrl: (url) => URL.revokeObjectURL(url),
        decode: async (url) => {
          const decoded = new Image();
          decoded.src = url;
          try {
            await decoded.decode();
          } catch {
            throw new Error("原图无法解码，请重试读取");
          }
          return { width: decoded.naturalWidth, height: decoded.naturalHeight };
        },
      },
      (image) => setImage({ ...image, generation: session.generation }),
      (error) => setError({ generation: session.generation, message: errorMessage(error) }),
    );
    return request.dispose;
  }, [session?.id, session?.generation, attempt]);
  return {
    image: image?.generation === session?.generation ? image : null,
    error: error?.generation === session?.generation ? (error?.message ?? null) : null,
    retry: () => setAttempt((value) => value + 1),
  };
}
