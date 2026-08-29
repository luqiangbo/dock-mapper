interface ImageActionOptions {
  exportPng: () => Promise<Uint8Array>;
  uploadImage: (png: Uint8Array) => Promise<string>;
  consumeImage: (imageId: string) => Promise<unknown>;
  releaseImage?: (imageId: string) => Promise<void>;
  onCommitted?: (png: Uint8Array) => Promise<void>;
  setBusy: (busy: boolean) => void;
  onError: (message: string) => void;
  fallbackError: string;
}

export function readableActionError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

export async function runImageAction(options: ImageActionOptions): Promise<boolean> {
  options.setBusy(true);
  let imageId: string | null = null;
  try {
    const png = await options.exportPng();
    imageId = await options.uploadImage(png);
    const consumed = await options.consumeImage(imageId);
    imageId = null;
    if (consumed === false) return false;
    await options.onCommitted?.(png);
    return true;
  } catch (error) {
    if (imageId) await options.releaseImage?.(imageId).catch(() => undefined);
    options.onError(readableActionError(error, options.fallbackError));
    return false;
  } finally {
    options.setBusy(false);
  }
}
