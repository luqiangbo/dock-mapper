import {
  normalizeArrowEffect,
  type ArrowEffect,
  type ArrowStyle,
  type GradientStop,
  type TextStyle,
} from "./annotationTypes";
import {
  arrowDragLength,
  calculateArrowGeometry,
  hasVisibleArrowLength,
  type ArrowGeometry,
  type ArrowPoint,
} from "./arrowShapes";
import { arrowSeed } from "./crayonBrush";
import { arrowEffectOpacity, arrowEffectPadding, paintArrowEffect } from "./arrowEffects";
import { paintCacheKey } from "./annotationPaint";

export {
  arrowContourPath,
  arrowOutlinePreview,
  calculateArrowGeometry,
  hasVisibleArrowLength,
  MIN_ARROW_LENGTH,
} from "./arrowShapes";
export type { ArrowGeometry, ArrowHeadGeometry, ArrowPoint } from "./arrowShapes";
export { arrowSeed } from "./crayonBrush";

interface CachedArrow {
  key: string;
  bitmap: HTMLCanvasElement;
  x: number;
  y: number;
  resolution: number;
}
const cache = new Map<string | number, CachedArrow>();
const geometryCache = new Map<string, ArrowGeometry>();
const MAX_CACHED_ARROWS = 48;
const MAX_CACHED_GEOMETRIES = 96;
const MAX_BITMAP_PIXELS = 4_000_000;
const MAX_TOTAL_BITMAP_PIXELS = 12_000_000;
let bitmapPixels = 0;

export function clearArrowRenderCache(): void {
  cache.clear();
  geometryCache.clear();
  bitmapPixels = 0;
}
function forget(id: string | number): void {
  const item = cache.get(id);
  if (item) bitmapPixels -= item.bitmap.width * item.bitmap.height;
  cache.delete(id);
}

/**
 * Geometry is cached apart from the painted bitmap, so changing only the
 * colour, gradient or effect repaints the material over the same shape.
 */
function horizontalGeometry(
  length: number,
  lineWidth: number,
  style: ArrowStyle,
): ArrowGeometry | null {
  const key = `${length}|${lineWidth}|${style}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const geometry = calculateArrowGeometry({
    start: { x: 0, y: 0 },
    end: { x: length, y: 0 },
    lineWidth,
    style,
  });
  if (!geometry) return null;
  if (geometryCache.size >= MAX_CACHED_GEOMETRIES)
    geometryCache.delete(geometryCache.keys().next().value!);
  geometryCache.set(key, geometry);
  return geometry;
}

export interface ArrowPaintRequest {
  start: ArrowPoint;
  end: ArrowPoint;
  style: ArrowStyle;
  /** Physical-pixel arrow width; the toolbar converts logical widths once. */
  lineWidth: number;
  /** Device pixels per scene unit; drives texture detail, never proportions. */
  canvasScale: number;
  color: string;
  effect?: ArrowEffect;
  gradientStops?: GradientStop[];
  /** Stable per-annotation seed, so textures survive redraws and undo. */
  textureSeed?: string | number;
  /** Legacy in-memory label arrows only. */
  label?: string;
  labelStyle?: TextStyle;
}

function paintLegacyLabel(
  context: CanvasRenderingContext2D,
  request: ArrowPaintRequest,
  length: number,
  angle: number,
): void {
  const style = request.labelStyle;
  if (!style) return;
  context.strokeStyle = request.color;
  context.lineWidth = Math.max(0.5, request.lineWidth);
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(length, 0);
  context.stroke();
  context.translate(length / 2, 0);
  context.rotate(-angle);
  const family =
    style.font === "serif"
      ? "Georgia, serif"
      : style.font === "mono"
        ? "Consolas, monospace"
        : '"Segoe UI", sans-serif';
  context.font = `${style.bold ? 700 : 400} ${style.fontSize}px ${family}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = style.color;
  context.fillText(request.label ?? "", 0, 0);
}

export function drawArrow(context: CanvasRenderingContext2D, request: ArrowPaintRequest): void {
  const { start, end } = request;
  if (!hasVisibleArrowLength(start, end)) return;
  const length = arrowDragLength(start, end);
  const scale = Math.max(0.25, request.canvasScale);
  const effect = normalizeArrowEffect(request.effect);
  const textureSeed = request.textureSeed ?? 0;
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  context.save();
  try {
    context.imageSmoothingEnabled = true;
    context.translate(start.x, start.y);
    context.rotate(angle);
    if (request.style === "label" && request.label && request.labelStyle) {
      paintLegacyLabel(context, request, length, angle);
      return;
    }
    const width = Math.max(1, request.lineWidth);
    const key = JSON.stringify([
      length,
      width,
      scale,
      request.style,
      request.color,
      effect,
      paintCacheKey(request.gradientStops),
    ]);
    let item = cache.get(textureSeed);
    if (item?.key !== key) {
      forget(textureSeed);
      const geometry = horizontalGeometry(length, width, request.style);
      if (!geometry) return;
      const padding = arrowEffectPadding(effect, width) + scale * 2;
      // Bound the working surface without changing the shape's proportions:
      // both endpoints and the width shrink by the same factor.
      const resolution = Math.min(
        1,
        Math.sqrt(
          MAX_BITMAP_PIXELS /
            ((geometry.bounds.width + padding * 2 + 10) *
              (geometry.bounds.height + padding * 2 + 10)),
        ),
      );
      const rendered =
        resolution === 1
          ? geometry
          : horizontalGeometry(length * resolution, width * resolution, request.style);
      if (!rendered) throw new Error("箭头尺寸无法渲染，请缩小箭头");
      const localScale = scale * resolution;
      const localPadding = arrowEffectPadding(effect, width * resolution) + localScale * 2;
      const x = Math.floor(rendered.bounds.x - localPadding),
        y = Math.floor(rendered.bounds.y - localPadding);
      const bitmap = document.createElement("canvas");
      bitmap.width = Math.ceil(rendered.bounds.width + localPadding * 2 + 2);
      bitmap.height = Math.ceil(rendered.bounds.height + localPadding * 2 + 2);
      const pixels = bitmap.width * bitmap.height;
      while (
        cache.size &&
        (cache.size >= MAX_CACHED_ARROWS || bitmapPixels + pixels > MAX_TOTAL_BITMAP_PIXELS)
      )
        forget(cache.keys().next().value!);
      const brush = bitmap.getContext("2d");
      if (!brush) throw new Error("箭头渲染失败：无法创建笔刷画布，请重试");
      brush.translate(-x, -y);
      paintArrowEffect(brush, rendered, {
        width: rendered.width,
        scale: localScale,
        seed: arrowSeed(`${textureSeed}:${request.style}`),
        color: request.color,
        effect,
        gradientStops: request.gradientStops,
      });
      item = { key, bitmap, x: x / resolution, y: y / resolution, resolution };
      cache.set(textureSeed, item);
      bitmapPixels += pixels;
    }
    // One composite alpha for the whole arrow: overlapping brush marks inside
    // the bitmap can never darken, and the alpha changes without a repaint.
    context.globalAlpha *= arrowEffectOpacity(effect);
    context.drawImage(
      item.bitmap,
      item.x,
      item.y,
      item.bitmap.width / item.resolution,
      item.bitmap.height / item.resolution,
    );
  } finally {
    context.restore();
  }
}
