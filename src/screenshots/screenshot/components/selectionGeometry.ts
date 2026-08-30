import type { Selection } from "../hooks/useCaptureLifecycle";

export const MIN_SELECTION_SIZE = 8;

export const RESIZE_HANDLES = ["nw", "n", "ne", "w", "e", "sw", "s", "se"] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

export interface SelectionCrop {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
}

export function calculateSelectionCrop(
  rect: Selection,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  heightOverride?: number,
): SelectionCrop {
  const scaleX = imageWidth / Math.max(1, viewportWidth);
  const scaleY = imageHeight / Math.max(1, viewportHeight);
  const logicalHeight = heightOverride ?? rect.height;
  const sourceX = Math.max(0, Math.min(rect.x * scaleX, imageWidth));
  const sourceY = Math.max(0, Math.min(rect.y * scaleY, imageHeight));
  const sourceRight = Math.max(
    sourceX,
    Math.min((rect.x + rect.width) * scaleX, imageWidth),
  );
  const sourceBottom = Math.max(
    sourceY,
    Math.min((rect.y + logicalHeight) * scaleY, imageHeight),
  );
  return {
    sourceX,
    sourceY,
    sourceWidth: Math.max(Number.EPSILON, sourceRight - sourceX),
    sourceHeight: Math.max(Number.EPSILON, sourceBottom - sourceY),
    outputWidth: Math.max(1, Math.round(rect.width * scaleX)),
    outputHeight: Math.max(1, Math.round(logicalHeight * scaleY)),
  };
}

export function mapCropPoint(
  point: { x: number; y: number },
  from: SelectionCrop,
  to: SelectionCrop,
): { x: number; y: number } {
  const imageX = from.sourceX + (point.x / from.outputWidth) * from.sourceWidth;
  const imageY = from.sourceY + (point.y / from.outputHeight) * from.sourceHeight;
  return {
    x: ((imageX - to.sourceX) / to.sourceWidth) * to.outputWidth,
    y: ((imageY - to.sourceY) / to.sourceHeight) * to.outputHeight,
  };
}

export const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  w: "ew-resize",
  e: "ew-resize",
  sw: "nesw-resize",
  s: "ns-resize",
  se: "nwse-resize",
};

export function resizeRect(
  origin: Selection,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
): Selection {
  const right = origin.x + origin.width;
  const bottom = origin.y + origin.height;
  let { x, y, width, height } = origin;
  if (handle.includes("w")) {
    x = Math.max(0, Math.min(origin.x + dx, right - MIN_SELECTION_SIZE));
    width = right - x;
  }
  if (handle.includes("e")) {
    width = Math.max(MIN_SELECTION_SIZE, Math.min(right + dx, viewportWidth) - x);
  }
  if (handle.includes("n")) {
    y = Math.max(0, Math.min(origin.y + dy, bottom - MIN_SELECTION_SIZE));
    height = bottom - y;
  }
  if (handle.includes("s")) {
    height = Math.max(MIN_SELECTION_SIZE, Math.min(bottom + dy, viewportHeight) - y);
  }
  return { x, y, width, height };
}

export function moveRect(
  origin: Selection,
  dx: number,
  dy: number,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
): Selection {
  return {
    ...origin,
    x: Math.max(0, Math.min(origin.x + dx, viewportWidth - origin.width)),
    y: Math.max(0, Math.min(origin.y + dy, viewportHeight - origin.height)),
  };
}
