import type { Drawable, Options } from "roughjs/bin/core";
import type { AnnotationOutlineConfig } from "../../../types";
import { arrowSeed } from "./crayonBrush";
import {
  normalizeArrowStyle,
  normalizeLineStyle,
  type Arrowhead,
  type ArrowStyle,
  type FillStyle,
  type FrameShape,
  type LineStyle,
  type Roughness,
} from "./annotationTypes";
import {
  annotationRoughGenerator,
  cachedRoughDrawable,
  paintRoughDrawable,
} from "./roughAnnotationStyle";

export interface LinePoint { x: number; y: number }
export interface LineBounds { x: number; y: number; width: number; height: number }
export interface ArrowLinePart { role: "shaft" | "head"; start: LinePoint; end: LinePoint }

const generator = annotationRoughGenerator();
const HEAD_ANGLE = (28 * Math.PI) / 180;

function roughOptions(
  color: string,
  width: number,
  strokeStyle: LineStyle | undefined,
  roughness: Roughness | undefined,
  seedValue: string | number,
  dimensions: { width: number; height: number },
): Options {
  const style = normalizeLineStyle(strokeStyle);
  const maxSize = Math.max(Math.abs(dimensions.width), Math.abs(dimensions.height));
  const minSize = Math.min(Math.abs(dimensions.width), Math.abs(dimensions.height));
  const requested = roughness ?? 1;
  const adjusted =
    (minSize >= 20 && maxSize >= 50) || maxSize >= 80
      ? requested
      : Math.min(requested / (maxSize < 10 ? 3 : 2), 2.5);
  const dash = style === "dashed" ? [8, 8 + width] : style === "dotted" ? [1.5, 6 + width] : undefined;
  return {
    seed: (arrowSeed(seedValue) % 0x7fffffff) || 1,
    stroke: color,
    strokeWidth: style === "solid" ? width : width + 0.5,
    strokeLineDash: dash,
    disableMultiStroke: style !== "solid",
    fillWeight: Math.max(0.5, width / 2),
    hachureGap: Math.max(4, width * 4),
    roughness: adjusted,
    preserveVertices: requested < 2,
    curveFitting: 1,
  };
}

export function linearDisplayPoints(
  start: LinePoint,
  end: LinePoint,
  arrowStyle: ArrowStyle,
  provided?: LinePoint[],
): LinePoint[] {
  const points = provided && provided.length >= 2 ? provided : [start, end];
  if (normalizeArrowStyle(arrowStyle) !== "elbow" || points.length > 2) return points;
  const middleX = (start.x + end.x) / 2;
  return [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end];
}

function arrowHeadParts(tip: LinePoint, previous: LinePoint, length: number): ArrowLinePart[] {
  const direction = Math.atan2(tip.y - previous.y, tip.x - previous.x);
  return [
    { role: "head", start: tip, end: { x: tip.x - Math.cos(direction - HEAD_ANGLE) * length, y: tip.y - Math.sin(direction - HEAD_ANGLE) * length } },
    { role: "head", start: tip, end: { x: tip.x - Math.cos(direction + HEAD_ANGLE) * length, y: tip.y - Math.sin(direction + HEAD_ANGLE) * length } },
  ];
}

/** Compatibility helper retained for geometry tests and old hot-reload objects. */
export function assembledArrowParts(
  start: LinePoint,
  end: LinePoint,
  arrowStyle: ArrowStyle,
  _seedValue: string | number,
): ArrowLinePart[] {
  const points = linearDisplayPoints(start, end, arrowStyle);
  const parts: ArrowLinePart[] = [];
  for (let index = 1; index < points.length; index += 1) {
    parts.push({ role: "shaft", start: points[index - 1], end: points[index] });
  }
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length >= 8) parts.push(...arrowHeadParts(end, points[points.length - 2] ?? start, Math.min(28, Math.max(12, length * 0.18))));
  return parts;
}

function pointBounds(points: LinePoint[], padding: number): LineBounds {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs) - padding;
  const top = Math.min(...ys) - padding;
  const right = Math.max(...xs) + padding;
  const bottom = Math.max(...ys) + padding;
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export function arrowVisualBounds(
  start: LinePoint,
  end: LinePoint,
  arrowStyle: ArrowStyle,
  width: number,
  seedValue: string | number,
  outlineWidth = 0,
  _lineStyle?: LineStyle,
  points?: LinePoint[],
): LineBounds {
  const parts = assembledArrowParts(start, end, arrowStyle, seedValue);
  return pointBounds(
    [...linearDisplayPoints(start, end, arrowStyle, points), ...parts.flatMap((part) => [part.start, part.end])],
    styledLinePadding(width, outlineWidth),
  );
}

export function styledLinePadding(width: number, outlineWidth = 0): number {
  return Math.max(4, width / 2 + outlineWidth + 4);
}

export function roughDrawableCacheKey(prefix: string, values: unknown[], options: Options): string {
  return JSON.stringify([prefix, ...values, options]);
}

function drawPath(
  context: CanvasRenderingContext2D,
  points: LinePoint[],
  curved: boolean,
  options: Options,
  cacheIdentity: unknown[],
  cacheOwner?: object,
): void {
  const pairs = points.map((point) => [point.x, point.y] as [number, number]);
  const create = (): Drawable => curved ? generator.curve(pairs, options) : generator.linearPath(pairs, options);
  paintRoughDrawable(context, cachedRoughDrawable(roughDrawableCacheKey("path", cacheIdentity, options), create, cacheOwner));
}

function drawArrowhead(
  context: CanvasRenderingContext2D,
  tip: LinePoint,
  previous: LinePoint,
  type: Arrowhead,
  color: string,
  width: number,
): void {
  if (type === "none") return;
  const angle = Math.atan2(tip.y - previous.y, tip.x - previous.x);
  const size = Math.max(10, Math.min(28, width * 4.5));
  const back = { x: tip.x - Math.cos(angle) * size, y: tip.y - Math.sin(angle) * size };
  const normal = { x: -Math.sin(angle), y: Math.cos(angle) };
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = Math.max(1, width);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  if (type === "arrow") {
    const parts = arrowHeadParts(tip, previous, size);
    context.moveTo(parts[0].end.x, parts[0].end.y);
    context.lineTo(tip.x, tip.y);
    context.lineTo(parts[1].end.x, parts[1].end.y);
    context.stroke();
  } else if (type === "bar") {
    context.moveTo(tip.x + normal.x * size * 0.45, tip.y + normal.y * size * 0.45);
    context.lineTo(tip.x - normal.x * size * 0.45, tip.y - normal.y * size * 0.45);
    context.stroke();
  } else if (type === "circle") {
    context.arc(tip.x - Math.cos(angle) * size * 0.35, tip.y - Math.sin(angle) * size * 0.35, size * 0.35, 0, Math.PI * 2);
    context.fill();
  } else {
    const half = size * 0.45;
    if (type === "triangle") {
      context.moveTo(tip.x, tip.y);
      context.lineTo(back.x + normal.x * half, back.y + normal.y * half);
      context.lineTo(back.x - normal.x * half, back.y - normal.y * half);
    } else {
      const middle = { x: (tip.x + back.x) / 2, y: (tip.y + back.y) / 2 };
      context.moveTo(tip.x, tip.y);
      context.lineTo(middle.x + normal.x * half, middle.y + normal.y * half);
      context.lineTo(back.x, back.y);
      context.lineTo(middle.x - normal.x * half, middle.y - normal.y * half);
    }
    context.closePath();
    context.fill();
  }
  context.restore();
}

export interface StyledLinearOptions {
  start: LinePoint;
  end: LinePoint;
  points?: LinePoint[];
  arrowStyle: ArrowStyle;
  lineStyle?: LineStyle;
  color: string;
  width: number;
  seed: string | number;
  roughness?: Roughness;
  startArrowhead?: Arrowhead;
  endArrowhead?: Arrowhead;
  outline?: AnnotationOutlineConfig;
  cacheOwner?: object;
}

export function drawStyledLine(context: CanvasRenderingContext2D, options: StyledLinearOptions): void {
  const points = linearDisplayPoints(options.start, options.end, options.arrowStyle, options.points);
  const bounds = pointBounds(points, 0);
  if (options.outline?.enabled && options.outline.width > 0) {
    drawPath(context, points, normalizeArrowStyle(options.arrowStyle) === "round", roughOptions(options.outline.color, options.width + options.outline.width * 2, options.lineStyle, options.roughness, `${options.seed}:outline`, bounds), [points, options.seed, "outline"], options.cacheOwner);
  }
  drawPath(context, points, normalizeArrowStyle(options.arrowStyle) === "round", roughOptions(options.color, options.width, options.lineStyle, options.roughness, options.seed, bounds), [points, options.seed, "stroke"], options.cacheOwner);
  drawArrowhead(context, points[0], points[1] ?? options.end, options.startArrowhead ?? "none", options.color, options.width);
  drawArrowhead(context, points[points.length - 1], points[points.length - 2] ?? options.start, options.endArrowhead ?? "none", options.color, options.width);
}

export function drawStyledArrow(context: CanvasRenderingContext2D, options: StyledLinearOptions): void {
  drawStyledLine(context, { ...options, endArrowhead: options.endArrowhead ?? "arrow" });
}

function shapePoints(kind: FrameShape, bounds: LineBounds): Array<[number, number]> {
  const { x, y, width, height } = bounds;
  if (kind === "diamond") return [[x + width / 2, y], [x + width, y + height / 2], [x + width / 2, y + height], [x, y + height / 2]];
  return [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
}

function frameDrawable(kind: FrameShape, bounds: LineBounds, options: Options): Drawable {
  if (kind === "ellipse") return generator.ellipse(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, bounds.width, bounds.height, options);
  if (kind === "diamond") return generator.polygon(shapePoints(kind, bounds), options);
  return generator.rectangle(bounds.x, bounds.y, bounds.width, bounds.height, options);
}

export function drawStyledFrame(
  context: CanvasRenderingContext2D,
  kind: FrameShape,
  bounds: LineBounds,
  color: string,
  width: number,
  lineStyle: LineStyle | undefined,
  seedValue: string | number,
  outline?: AnnotationOutlineConfig,
  fillColor = "transparent",
  fillStyle: FillStyle = "none",
  roughness: Roughness = 1,
  cacheOwner?: object,
): void {
  const options = roughOptions(color, width, lineStyle, roughness, seedValue, bounds);
  if (fillStyle !== "none" && fillColor !== "transparent") {
    options.fill = fillColor;
    options.fillStyle = fillStyle === "cross_hatch" ? "cross-hatch" : fillStyle;
  }
  if (outline?.enabled && outline.width > 0) {
    const outside = { ...options, stroke: outline.color, strokeWidth: width + outline.width * 2, fill: undefined };
    paintRoughDrawable(context, cachedRoughDrawable(roughDrawableCacheKey("frame-outline", [kind, bounds, seedValue], outside), () => frameDrawable(kind, bounds, outside), cacheOwner));
  }
  paintRoughDrawable(context, cachedRoughDrawable(roughDrawableCacheKey("frame", [kind, bounds, seedValue], options), () => frameDrawable(kind, bounds, options), cacheOwner));
}
