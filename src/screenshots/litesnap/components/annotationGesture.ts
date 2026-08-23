export type RasterTool = "rect" | "ellipse" | "arrow" | "pen" | "highlight" | "mosaic";

export interface GesturePoint {
  x: number;
  y: number;
}

export interface AnnotationGesture<TSnapshot> {
  pointerId: number;
  tool: RasterTool;
  start: GesturePoint;
  points: GesturePoint[];
  baseline: TSnapshot;
  changed: boolean;
}

export function createAnnotationGesture<TSnapshot>(
  pointerId: number,
  tool: RasterTool,
  start: GesturePoint,
  baseline: TSnapshot,
): AnnotationGesture<TSnapshot> {
  return {
    pointerId,
    tool,
    start,
    points: [start],
    baseline,
    changed: tool === "pen",
  };
}

export function appendGesturePoint<TSnapshot>(
  gesture: AnnotationGesture<TSnapshot>,
  point: GesturePoint,
): void {
  const previous = gesture.points[gesture.points.length - 1];
  if (previous.x === point.x && previous.y === point.y) return;
  gesture.points.push(point);
  gesture.changed = true;
}

export function shouldHandlePointer<TSnapshot>(
  gesture: AnnotationGesture<TSnapshot> | null,
  pointerId: number,
): gesture is AnnotationGesture<TSnapshot> {
  return gesture !== null && gesture.pointerId === pointerId;
}

export function resolveAnnotationGesture<TSnapshot>(
  gesture: AnnotationGesture<TSnapshot>,
  cancelled: boolean,
): { commit: boolean; restore: boolean } {
  return cancelled ? { commit: false, restore: true } : { commit: gesture.changed, restore: false };
}
