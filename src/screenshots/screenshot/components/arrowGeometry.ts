import { normalizeLineStyle, type ArrowStyle, type LineStyle, type TextStyle } from "./annotationTypes";
import { drawStyledArrow, type LinePoint } from "./annotationLineRenderer";
import { arrowDragLength, hasVisibleArrowLength } from "./arrowShapes";
import { arrowSeed } from "./crayonBrush";
import type { ArrowAssemblyVariation } from "./arrowAssembly";
import { clearRoughDrawableCache } from "./roughAnnotationStyle";

export {
  arrowContourPath,
  arrowOutlinePreview,
  calculateArrowGeometry,
  hasVisibleArrowLength,
  MIN_ARROW_LENGTH,
} from "./arrowShapes";
export type { ArrowGeometry, ArrowHeadGeometry, ArrowPoint } from "./arrowShapes";
export { arrowSeed } from "./crayonBrush";

export interface ArrowPaintRequest {
  start: LinePoint;
  end: LinePoint;
  style: ArrowStyle;
  lineWidth: number;
  canvasScale: number;
  color: string;
  lineStyle?: LineStyle;
  textureSeed?: string | number;
  assembly?: ArrowAssemblyVariation;
  label?: string;
  labelStyle?: TextStyle;
  /** Legacy values are accepted only to choose the closest semantic style. */
  brushId?: string;
  gradientStops?: Array<{ offset: number; color: string }>;
}

export function clearArrowRenderCache(): void {
  clearRoughDrawableCache();
}

export function arrowRenderCacheKey(
  request: Pick<
    ArrowPaintRequest,
    "style" | "canvasScale" | "color" | "lineStyle" | "brushId" | "assembly"
  > & { length: number; lineWidth: number; gradientStops?: Array<{ offset: number; color: string }> },
): string {
  return JSON.stringify([
    6,
    request.length,
    request.lineWidth,
    request.canvasScale,
    request.style,
    request.gradientStops?.[0]?.color ?? request.color,
    normalizeLineStyle(request.lineStyle, undefined, request.brushId),
    request.assembly ?? null,
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

function drawLegacyLabel(
  context: CanvasRenderingContext2D,
  request: ArrowPaintRequest,
  color: string,
): void {
  const style = request.labelStyle;
  if (!style || !request.label) return;
  const middleX = (request.start.x + request.end.x) / 2;
  const middleY = (request.start.y + request.end.y) / 2;
  const family =
    style.font === "serif"
      ? "Georgia, serif"
      : style.font === "mono"
        ? "Consolas, monospace"
        : '"Segoe UI", sans-serif';
  context.save();
  context.font = `${style.bold ? 700 : 400} ${style.fontSize}px ${family}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = style.color || color;
  context.fillText(request.label, middleX, middleY);
  context.restore();
}

/** Compatibility facade: all active painting now uses semantic vector lines. */
export function drawArrow(context: CanvasRenderingContext2D, request: ArrowPaintRequest): void {
  if (!hasVisibleArrowLength(request.start, request.end)) return;
  const color = request.gradientStops?.[0]?.color ?? request.color;
  drawStyledArrow(context, {
    start: request.start,
    end: request.end,
    arrowStyle: request.style,
    lineStyle: normalizeLineStyle(request.lineStyle, undefined, request.brushId),
    color,
    width: request.lineWidth,
    seed: request.textureSeed ?? arrowSeed(`${arrowDragLength(request.start, request.end)}`),
  });
  if (request.style === "label") drawLegacyLabel(context, request, color);
}
