import {
  getArrowBrushPreset,
  type ArrowBrushId,
  type ArrowBrushPreset,
} from "./arrowBrushPresets";
import type { GradientStop } from "./annotationTypes";
import type { ArrowGeometry, ArrowPoint, ArrowStroke } from "./arrowShapes";
import { colorChannels, createCanvasPaint, normalizeGradientStops } from "./annotationPaint";
import { paintP5ArrowMask } from "./p5ArrowBrush";
import { arrowLineParts } from "./arrowAssembly";

export function arrowBrushPadding(brushId: ArrowBrushId, width: number): number {
  const preset = getArrowBrushPreset(brushId);
  return preset.id === "solid" ? 0 : Math.max(1, width * preset.bleed);
}

export function arrowBrushOpacity(brushId: ArrowBrushId): number {
  return getArrowBrushPreset(brushId).opacity;
}

export function arrowBrushColorVariants(color: string): {
  base: number[];
  dark: number[];
  light: number[];
} {
  const base = colorChannels(color);
  return {
    base,
    dark: base.map((value) => Math.round(value * 0.58)),
    light: base.map((value) => Math.round(value + (255 - value) * 0.45)),
  };
}

export interface ArrowBrushPaintOptions {
  width: number;
  scale: number;
  seed: number;
  color: string;
  brushId: ArrowBrushId;
  gradientStops?: GradientStop[];
}

export interface ArrowBrushMaterial {
  brushId: ArrowBrushId;
  preset: ArrowBrushPreset;
  geometry: ArrowGeometry;
  outline: ArrowPoint[][];
  strokes: ArrowStroke[];
  width: number;
  scale: number;
  seed: number;
  color: string;
  gradientStops?: GradientStop[];
  opacity: number;
}

export function createArrowBrushMaterial(
  geometry: ArrowGeometry,
  options: ArrowBrushPaintOptions,
): ArrowBrushMaterial {
  const preset = getArrowBrushPreset(options.brushId);
  return {
    brushId: preset.id,
    preset,
    geometry,
    outline: geometry.contours,
    strokes: geometry.strokes,
    width: Math.max(0.5, options.width),
    scale: Math.max(0.25, options.scale),
    seed: options.seed,
    color: options.color,
    gradientStops: normalizeGradientStops(options.gradientStops),
    opacity: preset.opacity,
  };
}

export function createArrowBrushFill(
  context: CanvasRenderingContext2D,
  material: ArrowBrushMaterial,
): string | CanvasGradient {
  const { shaftStart: tail, shaftEnd: tip } = material.geometry;
  return material.gradientStops?.length
    ? createCanvasPaint(
        context,
        material.color,
        material.gradientStops,
        tail.x,
        tail.y,
        tip.x,
        tip.y,
      )
    : material.color;
}

export function paintArrowBrush(
  context: CanvasRenderingContext2D,
  geometry: ArrowGeometry,
  options: ArrowBrushPaintOptions,
): void {
  const material = createArrowBrushMaterial(geometry, options);
  const fill = createArrowBrushFill(context, material);
  if (material.brushId === "solid") {
    paintAssembledFallback(context, geometry, fill, material.width);
    return;
  }

  if (!paintP5ArrowMask(context, geometry, options)) {
    paintAssembledFallback(context, geometry, fill, material.width);
    return;
  }
  const padding = arrowBrushPadding(material.brushId, material.width) + material.scale * 2;
  context.save();
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-in";
  context.fillStyle = fill;
  context.fillRect(
    geometry.bounds.x - padding,
    geometry.bounds.y - padding,
    geometry.bounds.width + padding * 2,
    geometry.bounds.height + padding * 2,
  );
  context.restore();
}

function paintAssembledFallback(
  context: CanvasRenderingContext2D,
  geometry: ArrowGeometry,
  paint: string | CanvasGradient,
  width: number,
): void {
  context.save();
  context.strokeStyle = paint;
  context.lineWidth = width;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const part of arrowLineParts(geometry)) {
    context.beginPath();
    context.moveTo(part.start.x, part.start.y);
    context.lineTo(part.end.x, part.end.y);
    context.stroke();
  }
  context.restore();
}
