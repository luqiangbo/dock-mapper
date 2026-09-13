import { normalizeLineStyle } from "./annotationTypes";
import {
  annotationSolidColor,
  type RasterAnnotation,
  type SceneBounds,
} from "./annotationScene";
import { drawStyledArrow, drawStyledFrame, drawStyledLine } from "./annotationLineRenderer";
import { drawFreehandStroke } from "./freehandRenderer";

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
  base: HTMLCanvasElement,
): void {
  const first = annotation.points[0];
  const last = annotation.points[annotation.points.length - 1] ?? first;
  if (!first || !last) return;
  const style = annotation.style;
  const color = annotationSolidColor(style);
  const lineStyle = normalizeLineStyle(
    style.lineStyle,
    style.shapeEffect,
    style.arrowBrushId ?? style.arrowEffect,
  );
  if (annotation.kind === "pen" || annotation.kind === "highlight") {
    const geometry = annotation.points.reduce(
      (current, point) => ({
        minX: Math.min(current.minX, point.x),
        minY: Math.min(current.minY, point.y),
        maxX: Math.max(current.maxX, point.x),
        maxY: Math.max(current.maxY, point.y),
      }),
      { minX: first.x, minY: first.y, maxX: first.x, maxY: first.y },
    );
    context.save();
    if (annotation.angle) {
      const centerX = (geometry.minX + geometry.maxX) / 2;
      const centerY = (geometry.minY + geometry.maxY) / 2;
      context.translate(centerX, centerY);
      context.rotate(annotation.angle);
      context.translate(-centerX, -centerY);
    }
    drawFreehandStroke(
      context,
      annotation.kind,
      annotation.points,
      color,
      style.strokeWidth,
      style.opacity,
      style.outline,
      lineStyle,
      annotation.id,
      annotation.kind === "pen" && style.pressure !== false,
    );
    context.restore();
    return;
  }
  const x = Math.min(first.x, last.x);
  const y = Math.min(first.y, last.y);
  const width = Math.abs(last.x - first.x);
  const height = Math.abs(last.y - first.y);
  context.save();
  try {
    context.globalAlpha = 1;
    const angle = annotation.angle ?? 0;
    if (angle) {
      const centerX = x + width / 2;
      const centerY = y + height / 2;
      context.translate(centerX, centerY);
      context.rotate(angle);
      context.translate(-centerX, -centerY);
    }
    if (annotation.kind === "mosaic") {
      context.beginPath();
      context.rect(x, y, width, height);
      context.clip();
      drawMosaic(context, base, { x, y, width, height }, Math.max(2, style.mosaicBlock));
      return;
    }
    if (annotation.kind === "rect" || annotation.kind === "ellipse") {
      drawStyledFrame(
        context,
        annotation.kind,
        { x, y, width, height },
        color,
        style.strokeWidth,
        lineStyle,
        annotation.id,
        style.outline,
        style.backgroundColor,
        style.fillStyle,
        style.roughness,
        annotation,
      );
    } else if (annotation.kind === "diamond") {
      drawStyledFrame(
        context,
        "diamond",
        { x, y, width, height },
        color,
        style.strokeWidth,
        lineStyle,
        annotation.seed ?? annotation.id,
        style.outline,
        style.backgroundColor,
        style.fillStyle,
        style.roughness,
        annotation,
      );
    } else if (annotation.kind === "line") {
      drawStyledLine(context, {
        start: first,
        end: last,
        points: annotation.points,
        arrowStyle: style.arrowStyle,
        lineStyle,
        width: style.strokeWidth,
        color,
        seed: annotation.seed ?? annotation.id,
        roughness: style.roughness,
        outline: style.outline,
        cacheOwner: annotation,
      });
    } else if (annotation.kind === "arrow") {
      drawStyledArrow(context, {
        start: first,
        end: last,
        arrowStyle: style.arrowStyle,
        lineStyle,
        width: style.strokeWidth,
        color,
        seed: annotation.seed ?? annotation.id,
        points: annotation.points,
        roughness: style.roughness,
        startArrowhead: style.startArrowhead,
        endArrowhead: style.endArrowhead,
        outline: style.outline,
        cacheOwner: annotation,
      });
    }
  } finally {
    context.restore();
  }
}

function renderAnnotations(
  context: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  annotations: RasterAnnotation[],
  includeBase: boolean,
): void {
  context.save();
  try {
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    if (includeBase) context.drawImage(base, 0, 0);
    annotations.forEach((annotation) => drawRasterAnnotation(context, annotation, base));
  } finally {
    context.restore();
  }
}

/** Unified screen/export path. canvasScale remains accepted for caller compatibility. */
export function renderRasterScene(
  context: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  annotations: RasterAnnotation[],
  _canvasScale: number,
): void {
  renderAnnotations(context, base, annotations, true);
}

export function renderRasterOverlay(
  context: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  annotations: RasterAnnotation[],
  _canvasScale: number,
): void {
  renderAnnotations(context, base, annotations, false);
}
