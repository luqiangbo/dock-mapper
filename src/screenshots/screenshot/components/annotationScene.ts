import type {
  ArrowEffect,
  ArrowStyle,
  FrameEffect,
  FrameShape,
  GradientStop,
  TextStyle,
} from "./annotationTypes";
import { calculateArrowGeometry, drawArrow, hasVisibleArrowLength } from "./arrowGeometry";
import { arrowEffectPadding } from "./arrowEffects";
import { drawStyledFrame, shapeEffectPadding } from "./shapeEffects";

export interface ScenePoint {
  x: number;
  y: number;
}

export interface RasterAnnotationStyle {
  color: string;
  gradientStops?: GradientStop[];
  strokeWidth: number;
  fillOpacity: number;
  arrowStyle: ArrowStyle;
  arrowEffect?: ArrowEffect;
  shapeEffect?: FrameEffect;
  arrowHeadSize: number;
  opacity: number;
  mosaicBlock: number;
  arrowLabel?: string;
  arrowLabelStyle?: TextStyle;
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

export function isFrameAnnotationKind(kind: string | null): kind is FrameShape {
  return kind === "rect" || kind === "ellipse";
}

export function convertFrameAnnotation(
  annotation: RasterAnnotation,
  kind: FrameShape,
): RasterAnnotation {
  return isFrameAnnotationKind(annotation.kind) && annotation.kind !== kind
    ? { ...annotation, kind }
    : annotation;
}

function annotationPadding(annotation: RasterAnnotation): number {
  const labelPadding =
    annotation.kind === "arrow" && annotation.style.arrowStyle === "label"
      ? (annotation.style.arrowLabelStyle?.fontSize ?? 0) / 2 + 6
      : 0;
  const texturePadding =
    annotation.kind === "arrow"
      ? arrowEffectPadding(annotation.style.arrowEffect, annotation.style.strokeWidth)
      : annotation.kind === "rect" || annotation.kind === "ellipse"
        ? shapeEffectPadding(annotation.style.shapeEffect ?? "classic", annotation.style.strokeWidth)
        : 0;
  // Arrow geometry already spans the full painted area, so only the brush
  // bleed is added; every other kind is a centred stroke.
  const strokePadding = annotation.kind === "arrow" ? 0 : annotation.style.strokeWidth / 2;
  return Math.max(4, strokePadding, labelPadding, texturePadding);
}

export function annotationGeometryBounds(annotation: RasterAnnotation): SceneBounds {
  const lastPoint = annotation.points[annotation.points.length - 1];
  if (annotation.kind === "arrow" && annotation.points[0] && lastPoint) {
    const geometry = calculateArrowGeometry({
      start: annotation.points[0],
      end: lastPoint,
      lineWidth: annotation.style.strokeWidth,
      style: annotation.style.arrowStyle,
    });
    if (geometry) return geometry.bounds;
  }
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
    style: {
      ...item.style,
      gradientStops: item.style.gradientStops?.map((stop) => ({ ...stop })),
      arrowLabelStyle: item.style.arrowLabelStyle ? { ...item.style.arrowLabelStyle } : undefined,
    },
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
  if (annotation.kind === "arrow" && annotation.style.arrowStyle === "label") {
    const first = annotation.points[0];
    const last = annotation.points[annotation.points.length - 1] ?? first;
    const label = annotation.style.arrowLabel?.trim() ?? "";
    const fontSize = annotation.style.arrowLabelStyle?.fontSize ?? 24;
    const labelWidth = Math.max(fontSize * 1.5, label.length * fontSize * 0.68) + 16;
    const labelHeight = fontSize + 12;
    const labelX = (first.x + last.x) / 2 - labelWidth / 2;
    const labelY = (first.y + last.y) / 2 - labelHeight / 2;
    const left = Math.min(geometry.x - padding, labelX);
    const top = Math.min(geometry.y - padding, labelY);
    const right = Math.max(geometry.x + geometry.width + padding, labelX + labelWidth);
    const bottom = Math.max(geometry.y + geometry.height + padding, labelY + labelHeight);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
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
  if (annotation.kind === "arrow" && annotation.style.arrowStyle !== "label") {
    // Presets resize uniformly: the endpoints and the arrow width scale by the
    // same factor, so drawing, the selection box and the cache stay in step.
    // The brush bleed is not proportional, so the factor is fitted against the
    // real bounds and only a factor that stays inside the target is used.
    const previous = annotationBounds(annotation);
    const scaled = (scale: number): RasterAnnotation => ({
      ...annotation,
      style: { ...annotation.style, strokeWidth: annotation.style.strokeWidth * scale },
      points: annotation.points.map((point) => ({ x: point.x * scale, y: point.y * scale })),
    });
    // The painted bounds grow monotonically with the factor, so the largest
    // factor that still fits is found by bracketing and bisection.
    const fits = (scale: number): boolean => {
      const candidate = annotationBounds(scaled(scale));
      return (
        candidate.width <= nextBounds.width + 1e-9 && candidate.height <= nextBounds.height + 1e-9
      );
    };
    let low = 0.01;
    let high = Math.max(
      0.02,
      Math.min(nextBounds.width / previous.width, nextBounds.height / previous.height),
    );
    for (let pass = 0; pass < 10 && fits(high); pass += 1) {
      low = high;
      high *= 2;
    }
    for (let pass = 0; pass < 18; pass += 1) {
      const middle = (low + high) / 2;
      if (fits(middle)) low = middle;
      else high = middle;
    }
    const resized = scaled(low);
    const bounds = annotationBounds(resized);
    const x =
      Math.abs(nextBounds.x - previous.x) > 0.01
        ? nextBounds.x + nextBounds.width - bounds.width
        : nextBounds.x;
    const y =
      Math.abs(nextBounds.y - previous.y) > 0.01
        ? nextBounds.y + nextBounds.height - bounds.height
        : nextBounds.y;
    return {
      ...resized,
      points: resized.points.map((point) => ({
        x: point.x + x - bounds.x,
        y: point.y + y - bounds.y,
      })),
    };
  }
  const padding = annotationPadding(annotation);
  const targetWidth = Math.max(1, nextBounds.width - padding * 2);
  const targetHeight = Math.max(1, nextBounds.height - padding * 2);
  const targetX = nextBounds.x + padding;
  const targetY = nextBounds.y + padding;
  const scaleX = targetWidth / current.width;
  const scaleY = targetHeight / current.height;
  const labelScale = Math.max(0.1, (Math.abs(scaleX) + Math.abs(scaleY)) / 2);
  return {
    ...annotation,
    style: annotation.style.arrowLabelStyle
      ? {
          ...annotation.style,
          arrowLabelStyle: {
            ...annotation.style.arrowLabelStyle,
            fontSize: Math.max(
              8,
              Math.round(annotation.style.arrowLabelStyle.fontSize * labelScale),
            ),
            strokeWidth: annotation.style.arrowLabelStyle.strokeWidth * labelScale,
          },
        }
      : annotation.style,
    points: annotation.points.map((point) => ({
      x: targetX + (point.x - current.x) * scaleX,
      y: targetY + (point.y - current.y) * scaleY,
    })),
  };
}

/** A drag that produces no readable shape must not create an object. */
export function isPaintableAnnotation(annotation: RasterAnnotation): boolean {
  const first = annotation.points[0];
  const last = annotation.points[annotation.points.length - 1] ?? first;
  if (!first || !last) return false;
  if (annotation.kind === "arrow" && annotation.style.arrowStyle !== "label")
    return hasVisibleArrowLength(first, last);
  return true;
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
  try {
    context.globalAlpha = 1;
    context.strokeStyle = style.color;
    context.fillStyle = style.color;
    context.lineWidth = style.strokeWidth;
    context.lineCap = "round";
    context.lineJoin = "round";
    if (annotation.kind === "rect" || annotation.kind === "ellipse") {
      drawStyledFrame(
        context,
        annotation.kind,
        { x, y, width, height },
        style.color,
        style.strokeWidth,
        style.fillOpacity,
        style.shapeEffect ?? "classic",
        canvasScale,
        annotation.id,
        style.gradientStops,
      );
    } else if (annotation.kind === "arrow") {
      drawArrow(context, {
        start: first,
        end: last,
        style: style.arrowStyle,
        lineWidth: style.strokeWidth,
        canvasScale,
        color: style.color,
        effect: style.arrowEffect,
        gradientStops: style.gradientStops,
        textureSeed: annotation.id,
        label: style.arrowLabel,
        labelStyle: style.arrowLabelStyle,
      });
    }
  } finally {
    context.restore();
  }
}

export function renderRasterScene(
  context: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  annotations: RasterAnnotation[],
  canvasScale: number,
): void {
  context.save();
  try {
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    context.drawImage(base, 0, 0);
    annotations.forEach((annotation) =>
      drawRasterAnnotation(context, annotation, canvasScale, base),
    );
  } finally {
    context.restore();
  }
}

export function renderRasterOverlay(
  context: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  annotations: RasterAnnotation[],
  canvasScale: number,
): void {
  context.save();
  try {
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    annotations.forEach((annotation) =>
      drawRasterAnnotation(context, annotation, canvasScale, base),
    );
  } finally {
    context.restore();
  }
}
