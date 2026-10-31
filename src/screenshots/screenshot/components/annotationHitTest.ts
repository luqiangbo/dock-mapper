import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
type Element = ReturnType<ExcalidrawImperativeAPI["getSceneElements"]>[number];
function segmentDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
}
/** Hit visible geometry rather than claiming every empty pixel inside a line's bounding box. */
export function annotationHitTest(
  element: Element,
  point: { x: number; y: number },
  margin: number,
) {
  if (element.isDeleted || element.locked) return false;
  const cx = element.x + element.width / 2,
    cy = element.y + element.height / 2;
  const cos = Math.cos(-element.angle),
    sin = Math.sin(-element.angle);
  const px = point.x - cx,
    py = point.y - cy;
  const x = px * cos - py * sin + element.width / 2,
    y = px * sin + py * cos + element.height / 2;
  const tolerance = margin + element.strokeWidth / 2;
  if ("points" in element && element.points.length) {
    const points = element.points;
    const first = points[0],
      last = points[points.length - 1];
    if (
      element.backgroundColor &&
      element.backgroundColor !== "transparent" &&
      points.length > 3 &&
      first[0] === last[0] &&
      first[1] === last[1]
    ) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [ax, ay] = points[i],
          [bx, by] = points[j];
        if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      }
      if (inside) return true;
    }
    return element.points.some(([ax, ay], index, points) => {
      const [bx, by] = points[Math.min(points.length - 1, index + 1)];
      return segmentDistance(x, y, ax, ay, bx, by) <= tolerance;
    });
  }
  const w = element.width,
    h = element.height;
  if (x < -tolerance || y < -tolerance || x > w + tolerance || y > h + tolerance) return false;
  const filled = element.backgroundColor !== "transparent" && element.backgroundColor !== "";
  if (element.type === "ellipse") {
    const distance = Math.hypot(
      (x - w / 2) / Math.max(w / 2, 0.1),
      (y - h / 2) / Math.max(h / 2, 0.1),
    );
    const edge = tolerance / Math.max(0.1, Math.min(w, h) / 2);
    return filled ? distance <= 1 + edge : Math.abs(distance - 1) <= edge;
  }
  if (element.type === "diamond") {
    if (
      filled &&
      Math.abs(x - w / 2) / Math.max(0.1, w / 2) + Math.abs(y - h / 2) / Math.max(0.1, h / 2) <= 1
    )
      return true;
    return [
      [w / 2, 0, w, h / 2],
      [w, h / 2, w / 2, h],
      [w / 2, h, 0, h / 2],
      [0, h / 2, w / 2, 0],
    ].some(([ax, ay, bx, by]) => segmentDistance(x, y, ax, ay, bx, by) <= tolerance);
  }
  if (element.type === "rectangle" && !filled)
    return Math.min(Math.abs(x), Math.abs(y), Math.abs(w - x), Math.abs(h - y)) <= tolerance;
  return true;
}
