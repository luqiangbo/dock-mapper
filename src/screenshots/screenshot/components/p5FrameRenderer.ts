import type { FrameEffect, FrameShape, GradientStop } from "./annotationTypes";
import { createCanvasPaint } from "./annotationPaint";
import { brush, paintP5Mask } from "./p5BrushService";
import { roughFrameLines, type RoughPoint } from "./roughFrameGeometry";

interface FrameBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FrameBrush {
  name: string;
  baseWeight: number;
}

const FRAME_BRUSHES: Record<FrameEffect, FrameBrush> = {
  classic: { name: "rotring", baseWeight: 0.15 },
  crayon: { name: "crayon", baseWeight: 0.33 },
  handdrawn: { name: "pen", baseWeight: 0.3 },
  watercolor: { name: "dock-watercolor", baseWeight: 0.62 },
  ink: { name: "charcoal", baseWeight: 1.2 },
  cartoon: { name: "dock-marker", baseWeight: 2 },
  gradient: { name: "pen", baseWeight: 0.3 },
  decorative: { name: "HB", baseWeight: 0.65 },
};

function framePoints(kind: FrameShape, bounds: FrameBounds): RoughPoint[] {
  if (kind === "rect")
    return [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      { x: bounds.x, y: bounds.y + bounds.height },
    ];
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return Array.from({ length: 48 }, (_, index) => {
    const angle = (index / 48) * Math.PI * 2;
    return {
      x: centerX + Math.cos(angle) * bounds.width / 2,
      y: centerY + Math.sin(angle) * bounds.height / 2,
    };
  });
}

function maskCanvas(source: HTMLCanvasElement): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("框选笔刷渲染失败：无法创建蒙版画布");
  return [canvas, context];
}

function tintMask(
  context: CanvasRenderingContext2D,
  bounds: FrameBounds,
  color: string,
  gradientStops?: GradientStop[],
): void {
  context.save();
  context.globalCompositeOperation = "source-in";
  context.fillStyle = createCanvasPaint(
    context,
    color,
    gradientStops,
    bounds.x,
    bounds.y,
    bounds.x + bounds.width,
    bounds.y,
  );
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  context.restore();
}

export function paintP5Frame(
  context: CanvasRenderingContext2D,
  kind: FrameShape,
  bounds: FrameBounds,
  color: string,
  width: number,
  fillOpacity: number,
  effect: FrameEffect,
  seed: number,
  gradientStops?: GradientStop[],
): boolean {
  const target = context.canvas;
  const points = framePoints(kind, bounds);
  let fillCanvas: HTMLCanvasElement | null = null;
  if (fillOpacity > 0) {
    const [canvas, fillMask] = maskCanvas(target);
    if (
      !paintP5Mask(fillMask, seed ^ 0x41d3, () => {
        brush.noStroke();
        brush.noHatch();
        brush.noWash();
        brush.fill("#000000", 255);
        brush.fillBleed(effect === "watercolor" ? 0.08 : 0, "out");
        brush.fillTexture(effect === "watercolor" ? 0.78 : 0.08, 0, effect === "watercolor");
        brush.polygon(points.map(({ x, y }) => [x, y]));
      })
    )
      return false;
    tintMask(fillMask, bounds, color, gradientStops);
    fillCanvas = canvas;
  }

  const [strokeCanvas, strokeMask] = maskCanvas(target);
  const frameBrush = FRAME_BRUSHES[effect];
  const lines = effect === "handdrawn" ? roughFrameLines(kind, bounds, width, seed) : null;
  if (
    !paintP5Mask(strokeMask, seed, () => {
      brush.set(frameBrush.name, "#000000", width / frameBrush.baseWeight);
      brush.noFill();
      brush.noHatch();
      brush.noWash();
      if (lines)
        for (const line of lines)
          brush.spline(line.map(({ x, y }) => [x, y, 1]), 0);
      else brush.polygon(points.map(({ x, y }) => [x, y]));
    })
  )
    return false;
  tintMask(strokeMask, bounds, color, gradientStops);

  context.clearRect(0, 0, target.width, target.height);
  if (fillCanvas) {
    context.save();
    context.globalAlpha = fillOpacity;
    context.drawImage(fillCanvas, 0, 0);
    context.restore();
  }
  context.drawImage(strokeCanvas, 0, 0);
  return true;
}
