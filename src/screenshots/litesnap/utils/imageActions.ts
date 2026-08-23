interface ImageActionOptions {
  exportPng: () => Promise<Uint8Array>;
  uploadImage: (png: Uint8Array) => Promise<string>;
  consumeImage: (imageId: string) => Promise<unknown>;
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
  try {
    const imageId = await options.uploadImage(await options.exportPng());
    await options.consumeImage(imageId);
    return true;
  } catch (error) {
    options.onError(readableActionError(error, options.fallbackError));
    return false;
  } finally {
    options.setBusy(false);
  }
}
