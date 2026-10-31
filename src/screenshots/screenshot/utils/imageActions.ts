interface ImageActionOptions {
  exportPng: () => Promise<Uint8Array>;
  uploadImage: (png: Uint8Array) => Promise<string>;
  consumeImage: (imageId: string) => Promise<unknown>;
  releaseImage?: (imageId: string) => Promise<void>;
  onCommitted?: (png: Uint8Array) => Promise<void>;
  onCommittedError?: (message: string) => Promise<void> | void;
  setBusy: (busy: boolean) => void;
  onError: (message: string) => void;
  fallbackError: string;
}

/** Cancellation advances the caller's token, allowing a new capture to commit. */
export class ImageActionGate {
  private active: number | null = null;
  begin(current: number): number | null {
    if (this.active === current) return null;
    this.active = current + 1;
    return this.active;
  }
  finish(token: number) {
    if (this.active === token) this.active = null;
  }
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
    try {
      await options.onCommitted?.(png);
    } catch (error) {
      const message =
        "截图操作已完成，但未保存到历史：" + readableActionError(error, "历史写入失败");
      if (options.onCommittedError) {
        try {
          await options.onCommittedError(message);
        } catch (notifyError) {
          console.error("历史失败通知未送达", notifyError);
        }
      } else console.error(message);
    }
    return true;
  } catch (error) {
    if (imageId)
      await options
        .releaseImage?.(imageId)
        .catch((cleanupError) => console.error("截图临时图片释放失败", cleanupError));
    options.onError(readableActionError(error, options.fallbackError));
    return false;
  } finally {
    options.setBusy(false);
  }
}
