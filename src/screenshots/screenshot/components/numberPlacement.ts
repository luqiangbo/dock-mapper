import { clientToBitmap, screenshotViewport, type ViewportRect } from "./screenshotViewport";
export function numberPlacementPoint(
  client: { x: number; y: number },
  bitmap: { width: number; height: number },
  bounds: ViewportRect,
  origin: { x: number; y: number },
) {
  const view = screenshotViewport(bitmap.width, bitmap.height, bounds);
  const point = clientToBitmap(client, view);
  return {
    point,
    zoom: view.zoom,
    left: view.insetX + point.x * view.zoom,
    top: view.insetY + point.y * view.zoom,
    world: { x: origin.x + point.x, y: origin.y + point.y },
    inside: point.x >= 0 && point.y >= 0 && point.x <= bitmap.width && point.y <= bitmap.height,
  };
}
export function isNumberPlacementClick(
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  return Math.hypot(end.x - start.x, end.y - start.y) <= 3;
}
