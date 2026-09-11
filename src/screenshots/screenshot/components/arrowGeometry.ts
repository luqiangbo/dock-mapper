import type { ArrowStyle, GradientStop, TextStyle } from "./annotationTypes";
import {
  arrowDragLength,
  calculateArrowGeometry,
  hasVisibleArrowLength,
  type ArrowGeometry,
  type ArrowPoint,
} from "./arrowShapes";
import { arrowSeed } from "./crayonBrush";
import {
  arrowBrushOpacity,
  arrowBrushPadding,
  paintArrowBrush,
} from "./arrowBrushRenderer";
import {
  ARROW_BRUSH_RENDER_VERSION,
  normalizeArrowBrushId,
  type ArrowBrushId,
} from "./arrowBrushPresets";
import { paintCacheKey } from "./annotationPaint";
import { arrowAssemblyKey, type ArrowAssemblyVariation } from "./arrowAssembly";

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
  assembly?: ArrowAssemblyVariation,
): ArrowGeometry | null {
  const key = `${length}|${lineWidth}|${style}|${arrowAssemblyKey(assembly)}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const geometry = calculateArrowGeometry({
    start: { x: 0, y: 0 },
    end: { x: length, y: 0 },
    lineWidth,
    style,
    assembly,
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
  brushId?: ArrowBrushId;
  gradientStops?: GradientStop[];
  /** Stable per-annotation seed, so textures survive redraws and undo. */
  textureSeed?: string | number;
  /** Frozen endpoint/head proportions; the A-to-B center axis always stays straight. */
  assembly?: ArrowAssemblyVariation;
  /** Legacy in-memory label arrows only. */
  label?: string;
  labelStyle?: TextStyle;
}

export function arrowRenderCacheKey(
  request: Pick<
    ArrowPaintRequest,
    "style" | "canvasScale" | "color" | "brushId" | "gradientStops" | "assembly"
  > & { length: number; lineWidth: number },
): string {
  return JSON.stringify([
    ARROW_BRUSH_RENDER_VERSION,
    request.length,
    request.lineWidth,
    request.canvasScale,
    request.style,
    request.color,
    normalizeArrowBrushId(request.brushId),
    paintCacheKey(request.gradientStops),
    arrowAssemblyKey(request.assembly),
  ]);
}

export interface AlphaBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function alphaContentBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): AlphaBounds | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left
    ? null
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function cropCanvasToAlpha(
  source: HTMLCanvasElement,
  safety: number,
): { canvas: HTMLCanvasElement; offsetX: number; offsetY: number } {
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("箭头渲染失败：无法读取笔刷像素，请重试");
  const bounds = alphaContentBounds(
    context.getImageData(0, 0, source.width, source.height).data,
    source.width,
    source.height,
  );
  if (!bounds) throw new Error("箭头笔刷渲染失败，请重试");
  const left = Math.max(0, bounds.x - safety);
  const top = Math.max(0, bounds.y - safety);
  const right = Math.min(source.width, bounds.x + bounds.width + safety);
  const bottom = Math.min(source.height, bounds.y + bounds.height + safety);
  if (left === 0 && top === 0 && right === source.width && bottom === source.height) {
    return { canvas: source, offsetX: 0, offsetY: 0 };
  }
  const cropped = document.createElement("canvas");
  cropped.width = Math.max(1, right - left);
  cropped.height = Math.max(1, bottom - top);
  const croppedContext = cropped.getContext("2d");
  if (!croppedContext) throw new Error("箭头渲染失败：无法裁切笔刷像素，请重试");
  croppedContext.drawImage(
    source,
    left,
    top,
    cropped.width,
    cropped.height,
    0,
    0,
    cropped.width,
    cropped.height,
  );
  return { canvas: cropped, offsetX: left, offsetY: top };
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
  const brushId = normalizeArrowBrushId(request.brushId);
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
    const key = arrowRenderCacheKey({
      length,
      lineWidth: width,
      canvasScale: scale,
      style: request.style,
      color: request.color,
      brushId,
      gradientStops: request.gradientStops,
      assembly: request.assembly,
    });
    let item = cache.get(textureSeed);
    if (item?.key !== key) {
      forget(textureSeed);
      const geometry = horizontalGeometry(length, width, request.style, request.assembly);
      if (!geometry) return;
      const padding = arrowBrushPadding(brushId, width) + scale * 2;
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
          : horizontalGeometry(
              length * resolution,
              width * resolution,
              request.style,
              request.assembly,
            );
      if (!rendered) throw new Error("箭头尺寸无法渲染，请缩小箭头");
      const localScale = scale * resolution;
      const localPadding = arrowBrushPadding(brushId, width * resolution) + localScale * 2;
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
      paintArrowBrush(brush, rendered, {
        width: rendered.width,
        scale: localScale,
        seed: arrowSeed(`${textureSeed}:${request.style}`),
        color: request.color,
        brushId,
        gradientStops: request.gradientStops,
      });
      const cropped = cropCanvasToAlpha(bitmap, Math.max(1, Math.ceil(localScale)));
      item = {
        key,
        bitmap: cropped.canvas,
        x: (x + cropped.offsetX) / resolution,
        y: (y + cropped.offsetY) / resolution,
        resolution,
      };
      cache.set(textureSeed, item);
      bitmapPixels += item.bitmap.width * item.bitmap.height;
    }
    // One composite alpha for the whole arrow: overlapping brush marks inside
    // the bitmap can never darken, and the alpha changes without a repaint.
    context.globalAlpha *= arrowBrushOpacity(brushId);
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
