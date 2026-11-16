export interface NoticeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface NoticeMetrics {
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}

const GAP = 8;
function overlaps(a: NoticeBounds, b: NoticeBounds) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Viewport CSS pixels, measured notice height; prefer the outside of the capture. */
export function captureNoticePosition(
  bounds: NoticeBounds | null,
  metrics: NoticeMetrics,
  reserved: NoticeBounds[] = [],
) {
  const maxWidth = Math.max(1, Math.min(360, metrics.viewportWidth - GAP * 2));
  const width = Math.min(metrics.width, maxWidth);
  const height = metrics.height;
  const right = Math.max(GAP, metrics.viewportWidth - GAP - width);
  const bottom = Math.max(GAP, metrics.viewportHeight - GAP - height);
  const clampX = (x: number) => Math.max(GAP, Math.min(right, x));
  const preferredX = bounds ? bounds.x + bounds.width - width : metrics.viewportWidth - width - 16;
  const x = clampX(preferredX);
  const make = (x: number, y: number) => ({ x, y, width, height });
  const obstacles = reserved;
  const clear = (rect: NoticeBounds) => obstacles.every((obstacle) => !overlaps(rect, obstacle));
  let candidates: NoticeBounds[] = [];
  if (bounds) {
    candidates = [make(x, bounds.y - GAP - height)];
    for (const obstacle of obstacles) {
      candidates.push(
        make(x, obstacle.y - GAP - height),
        make(x, obstacle.y + obstacle.height + GAP),
      );
    }
    candidates.push(make(x, bounds.y + bounds.height + GAP));
  }
  const outside = candidates.find(
    (rect) =>
      rect.x >= GAP &&
      rect.x <= right &&
      rect.y >= GAP &&
      rect.y <= bottom &&
      !overlaps(rect, bounds!) &&
      clear(rect),
  );
  // A full-screen capture has no outside space in this WebView. Keep feedback readable.
  // Preserve right anchoring even when the capture touches screen edges.
  const fallback = [
    make(x, 16),
    ...obstacles.flatMap((obstacle) => [
      make(x, obstacle.y - GAP - height),
      make(x, obstacle.y + obstacle.height + GAP),
    ]),
    make(x, bottom),
  ].map((rect) => ({ ...rect, y: Math.max(GAP, Math.min(bottom, rect.y)) }));
  const selected = outside ?? fallback.find(clear) ?? fallback[0];
  return {
    left: `${selected.x}px`,
    top: `${selected.y}px`,
    maxWidth: `${maxWidth}px`,
    outside: !!outside,
  };
}
