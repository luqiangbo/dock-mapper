import type { MutableRefObject } from "react";
import { RequestGeneration } from "./requestGeneration";

interface SelectionImageRequestOptions<Result> {
  request: MutableRefObject<RequestGeneration>;
  generation: number;
  exportPng: () => Promise<Uint8Array>;
  execute: (imageId: string) => Promise<Result>;
}

/** Runs a latest-only image request and releases bytes that native code did not consume. */
export async function runSelectionImageRequest<Result>({
  request,
  generation,
  exportPng,
  execute,
}: SelectionImageRequestOptions<Result>): Promise<Result | null> {
  let imageId: string | null = null;
  try {
    const png = await exportPng();
    if (!request.current.isCurrent(generation)) return null;
    imageId = await window.api.uploadImage(png);
    if (!request.current.isCurrent(generation)) return null;
    const result = await execute(imageId);
    imageId = null;
    return request.current.isCurrent(generation) ? result : null;
  } finally {
    if (imageId) await window.api.releaseImage(imageId).catch(() => undefined);
  }
}
