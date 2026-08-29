import type { ArrowStyle } from "./annotationTypes";
import { drawArrow } from "./arrowGeometry";

export interface ScenePoint {
  x: number;
  y: number;
}

export interface RasterAnnotationStyle {
  color: string;
  strokeWidth: number;
  fillOpacity: number;
  arrowStyle: ArrowStyle;
  arrowHeadSize: number;
  opacity: number;
  mosaicBlock: number;
}

export type RasterAnnotationKind = "rect" | "ellipse" | "arrow" | "pen" | "highlight" | "mosaic";

export interface RasterAnnotation {
  id: string;
  kind: RasterAnnotationKind;
  points: ScenePoint[];
  style: RasterAnnotationStyle;
}

export interface SceneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function annotationPadding(annotation: RasterAnnotation): number {
  return Math.max(4, annotation.style.strokeWidth / 2);
}

export function annotationGeometryBounds(annotation: RasterAnnotation): SceneBounds {
  const xs = annotation.points.map((point) => point.x);
  const ys = annotation.points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function cloneRasterAnnotations(items: RasterAnnotation[]): RasterAnnotation[] {
  return items.map((item) => ({
    ...item,
    points: item.points.map((point) => ({ ...point })),
    style: { ...item.style },
  }));
}

export function simplifyScenePoints(points: ScenePoint[], minimumDistance = 1): ScenePoint[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  const result = [{ ...points[0] }];
  let previous = points[0];
  const threshold = minimumDistance * minimumDistance;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    if (dx * dx + dy * dy >= threshold) {
      result.push({ ...point });
      previous = point;
    }
  }
  result.push({ ...points[points.length - 1] });
  return result;
}

export function annotationBounds(annotation: RasterAnnotation): SceneBounds {
  const geometry = annotationGeometryBounds(annotation);
  const padding = annotationPadding(annotation);
  return {
    x: geometry.x - padding,
    y: geometry.y - padding,
    width: geometry.width + padding * 2,
    height: geometry.height + padding * 2,
  };
}

export function translateAnnotation(
  annotation: RasterAnnotation,
  dx: number,
  dy: number,
  canvasWidth: number,
  canvasHeight: number,
): RasterAnnotation {
  const bounds = annotationBounds(annotation);
  const clampedDx = Math.max(-bounds.x, Math.min(dx, canvasWidth - bounds.x - bounds.width));
  const clampedDy = Math.max(-bounds.y, Math.min(dy, canvasHeight - bounds.y - bounds.height));
  return {
    ...annotation,
    points: annotation.points.map((point) => ({
      x: point.x + clampedDx,
      y: point.y + clampedDy,
    })),
  };
}

export function resizeAnnotation(
  annotation: RasterAnnotation,
  nextBounds: SceneBounds,
): RasterAnnotation {
  const current = annotationGeometryBounds(annotation);
  const padding = annotationPadding(annotation);
  const targetWidth = Math.max(1, nextBounds.width - padding * 2);
  const targetHeight = Math.max(1, nextBounds.height - padding * 2);
  const targetX = nextBounds.x + padding;
  const targetY = nextBounds.y + padding;
  const scaleX = targetWidth / current.width;
  const scaleY = targetHeight / current.height;
  return {
    ...annotation,
    points: annotation.points.map((point) => ({
      x: targetX + (point.x - current.x) * scaleX,
      y: targetY + (point.y - current.y) * scaleY,
    })),
  };
}

export function hitTestAnnotation(
  annotation: RasterAnnotation,
  point: ScenePoint,
  tolerance = 6,
): boolean {
  const bounds = annotationBounds(annotation);
  return (
    point.x >= bounds.x - tolerance &&
    point.x <= bounds.x + bounds.width + tolerance &&
    point.y >= bounds.y - tolerance &&
    point.y <= bounds.y + bounds.height + tolerance
  );
}

function drawPolyline(
  context: CanvasRenderingContext2D,
  points: ScenePoint[],
  color: string,
  width: number,
  opacity: number,
): void {
  if (points.length === 0) return;
  context.save();
  context.globalAlpha = opacity;
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  points.forEach((point, index) =>
    index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y),
  );
  if (points.length === 1) context.lineTo(points[0].x + 0.01, points[0].y + 0.01);
  context.stroke();
  context.restore();
}

function drawMosaic(
  context: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  bounds: SceneBounds,
  block: number,
): void {
  const x = Math.max(0, Math.floor(bounds.x));
  const y = Math.max(0, Math.floor(bounds.y));
  const width = Math.min(base.width - x, Math.max(1, Math.round(bounds.width)));
  const height = Math.min(base.height - y, Math.max(1, Math.round(bounds.height)));
  if (width < 2 || height < 2) return;
  const scratch = document.createElement("canvas");
  scratch.width = Math.max(1, Math.ceil(width / block));
  scratch.height = Math.max(1, Math.ceil(height / block));
  const scratchContext = scratch.getContext("2d");
  if (!scratchContext) return;
  scratchContext.imageSmoothingEnabled = true;
  scratchContext.drawImage(base, x, y, width, height, 0, 0, scratch.width, scratch.height);
  context.save();
  context.imageSmoothingEnabled = false;
  context.drawImage(scratch, 0, 0, scratch.width, scratch.height, x, y, width, height);
  context.restore();
}

export function drawRasterAnnotation(
  context: CanvasRenderingContext2D,
  annotation: RasterAnnotation,
  canvasScale: number,
  base: HTMLCanvasElement,
): void {
  const first = annotation.points[0];
  const last = annotation.points[annotation.points.length - 1] ?? first;
  if (!first || !last) return;
  const style = annotation.style;
  if (annotation.kind === "pen" || annotation.kind === "highlight") {
    drawPolyline(context, annotation.points, style.color, style.strokeWidth, style.opacity);
    return;
  }
  const x = Math.min(first.x, last.x);
  const y = Math.min(first.y, last.y);
  const width = Math.abs(last.x - first.x);
  const height = Math.abs(last.y - first.y);
  if (annotation.kind === "mosaic") {
    drawMosaic(context, base, { x, y, width, height }, Math.max(2, style.mosaicBlock));
    return;
  }
  context.save();
  context.globalAlpha = 1;
  context.strokeStyle = style.color;
  context.fillStyle = style.color;
  context.lineWidth = style.strokeWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (annotation.kind === "rect") {
    if (style.fillOpacity) {
      context.globalAlpha = style.fillOpacity;
      context.fillRect(first.x, first.y, last.x - first.x, last.y - first.y);
      context.globalAlpha = 1;
    }
    context.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y);
  } else if (annotation.kind === "ellipse") {
    context.beginPath();
    context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    if (style.fillOpacity) {
      context.globalAlpha = style.fillOpacity;
      context.fill();
      context.globalAlpha = 1;
    }
    context.stroke();
  } else if (annotation.kind === "arrow") {
    drawArrow(context, first, last, style.arrowStyle, style.arrowHeadSize, canvasScale);
  }
  context.restore();
}

export function renderRasterScene(
  context: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  annotations: RasterAnnotation[],
  canvasScale: number,
): void {
  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.drawImage(base, 0, 0);
  annotations.forEach((annotation) => drawRasterAnnotation(context, annotation, canvasScale, base));
  context.restore();
}

export function renderRasterOverlay(
  context: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  annotations: RasterAnnotation[],
  canvasScale: number,
): void {
  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  annotations.forEach((annotation) => drawRasterAnnotation(context, annotation, canvasScale, base));
  context.restore();
}
