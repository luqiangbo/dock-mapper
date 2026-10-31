import type { Selection } from "../hooks/useCaptureLifecycle";
export const exceedsDragThreshold = (dx: number, dy: number) => Math.hypot(dx, dy) > 3;
export function moveCaptureSelection(
  origin: Selection,
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): Selection {
  const sx = imageWidth / viewportWidth,
    sy = imageHeight / viewportHeight;
  const width = Math.min(imageWidth, Math.round(origin.width * sx));
  const height = Math.min(imageHeight, Math.round(origin.height * sy));
  return {
    x: Math.max(0, Math.min(imageWidth - width, Math.round((origin.x + dx) * sx))) / sx,
    y: Math.max(0, Math.min(imageHeight - height, Math.round((origin.y + dy) * sy))) / sy,
    width: width / sx,
    height: height / sy,
  };
}

/** A drag can preview repeatedly, but commits at most once; cancellation commits nothing. */
export class SelectionDragSession {
  next: Selection;
  moved = false;
  private ended = false;
  constructor(readonly origin: Selection) {
    this.next = origin;
  }
  update(
    dx: number,
    dy: number,
    resolve: (origin: Selection, dx: number, dy: number) => Selection,
  ) {
    if (this.ended || (!this.moved && !exceedsDragThreshold(dx, dy))) return false;
    this.moved = true;
    this.next = resolve(this.origin, dx, dy);
    return true;
  }
  finish(cancel = false) {
    if (this.ended) return null;
    this.ended = true;
    return this.moved && !cancel ? this.next : null;
  }
}
