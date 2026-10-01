export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface ScreenshotViewport extends ViewportRect {
  zoom: number;
  insetX: number;
  insetY: number;
  scrollX: number;
  scrollY: number;
}

export function screenshotViewport(
  width: number,
  height: number,
  rect: ViewportRect,
): ScreenshotViewport {
  const zoom = Math.min(rect.width / Math.max(1, width), rect.height / Math.max(1, height));
  const safeZoom = Math.max(Number.EPSILON, zoom);
  const insetX = (rect.width - width * safeZoom) / 2;
  const insetY = (rect.height - height * safeZoom) / 2;
  return {
    ...rect,
    zoom: safeZoom,
    insetX,
    insetY,
    scrollX: insetX / safeZoom,
    scrollY: insetY / safeZoom,
  };
}

export function bitmapToClient(point: { x: number; y: number }, view: ScreenshotViewport) {
  return {
    x: view.left + view.insetX + point.x * view.zoom,
    y: view.top + view.insetY + point.y * view.zoom,
  };
}

export function clientToBitmap(point: { x: number; y: number }, view: ScreenshotViewport) {
  return {
    x: (point.x - view.left - view.insetX) / view.zoom,
    y: (point.y - view.top - view.insetY) / view.zoom,
  };
}
