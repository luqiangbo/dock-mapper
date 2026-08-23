import type { Selection } from "../store";

const MIN_SIZE = 8;

export const RESIZE_HANDLES = ["nw", "n", "ne", "w", "e", "sw", "s", "se"] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

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
    x = Math.max(0, Math.min(origin.x + dx, right - MIN_SIZE));
    width = right - x;
  }
  if (handle.includes("e")) width = Math.max(MIN_SIZE, Math.min(right + dx, viewportWidth) - x);
  if (handle.includes("n")) {
    y = Math.max(0, Math.min(origin.y + dy, bottom - MIN_SIZE));
    height = bottom - y;
  }
  if (handle.includes("s")) height = Math.max(MIN_SIZE, Math.min(bottom + dy, viewportHeight) - y);
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
