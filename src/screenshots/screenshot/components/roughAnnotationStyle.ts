import rough from "roughjs";
import type { Drawable, Op, Options } from "roughjs/bin/core";
import type { LineStyle } from "./annotationTypes";
import { arrowSeed } from "./crayonBrush";

export interface RoughDimensions {
  width: number;
  height: number;
}

const generator = rough.generator();
const drawableCache = new Map<string, Drawable>();
let drawableReferenceCache = new WeakMap<object, Map<string, Drawable>>();
const MAX_CACHE_ENTRIES = 320;

export function annotationRoughGenerator() {
  return generator;
}

function adjustedRoughness(style: LineStyle, dimensions: RoughDimensions): number {
  const base = style === "solid" ? 0.82 : 0.72;
  const maximum = Math.max(Math.abs(dimensions.width), Math.abs(dimensions.height));
  const minimum = Math.min(Math.abs(dimensions.width), Math.abs(dimensions.height));
  if ((minimum >= 20 && maximum >= 50) || maximum >= 80) return base;
  return Math.min(base / (maximum < 10 ? 3 : 2), 1.2);
}

/** Excalidraw-inspired option normalization shared by preview and export. */
export function annotationRoughOptions(
  style: LineStyle,
  color: string,
  strokeWidth: number,
  seedValue: string | number,
  dimensions: RoughDimensions,
): Options {
  const seed = (arrowSeed(seedValue) % 0x7fffffff) || 1;
  const patterned = style !== "solid";
  return {
    seed,
    stroke: color,
    strokeWidth,
    fillWeight: Math.max(0.8, strokeWidth / 2),
    hachureGap: Math.max(4, strokeWidth * 3.2),
    hachureAngle: -52,
    roughness: adjustedRoughness(style, dimensions),
    bowing: 0,
    maxRandomnessOffset: Math.min(2, Math.max(0.45, strokeWidth * 0.28)),
    preserveVertices: true,
    disableMultiStroke: patterned,
    disableMultiStrokeFill: patterned,
    curveFitting: 1,
  };
}

function appendOp(context: CanvasRenderingContext2D, op: Op): void {
  const data = op.data;
  if (op.op === "move") context.moveTo(data[0], data[1]);
  else if (op.op === "lineTo") context.lineTo(data[0], data[1]);
  else if (op.op === "bcurveTo")
    context.bezierCurveTo(data[0], data[1], data[2], data[3], data[4], data[5]);
}

/** Paints every RoughJS op-set, including solid and patterned fills. */
export function paintRoughDrawable(
  context: CanvasRenderingContext2D,
  drawable: Drawable,
): void {
  const options = drawable.options;
  for (const set of drawable.sets) {
    context.save();
    context.beginPath();
    set.ops.forEach((op) => appendOp(context, op));
    context.lineCap = "round";
    context.lineJoin = "round";
    if (set.type === "fillPath") {
      context.fillStyle = options.fill ?? "transparent";
      context.fill(drawable.shape === "path" || drawable.shape === "polygon" ? "evenodd" : "nonzero");
    } else {
      context.strokeStyle =
        set.type === "fillSketch" ? (options.fill ?? "transparent") : (options.stroke ?? "transparent");
      context.lineWidth =
        set.type === "fillSketch"
          ? options.fillWeight && options.fillWeight >= 0
            ? options.fillWeight
            : options.strokeWidth / 2
          : options.strokeWidth;
      if (set.type === "fillSketch" && options.fillLineDash)
        context.setLineDash(options.fillLineDash);
      if (set.type === "path" && options.strokeLineDash)
        context.setLineDash(options.strokeLineDash);
      context.stroke();
    }
    context.restore();
  }
}

export function cachedRoughDrawable(key: string, create: () => Drawable, owner?: object): Drawable {
  if (owner) {
    let entries = drawableReferenceCache.get(owner);
    if (!entries) {
      entries = new Map();
      drawableReferenceCache.set(owner, entries);
    }
    const referenced = entries.get(key);
    if (referenced) return referenced;
    const drawable = create();
    entries.set(key, drawable);
    return drawable;
  }
  const cached = drawableCache.get(key);
  if (cached) {
    drawableCache.delete(key);
    drawableCache.set(key, cached);
    return cached;
  }
  const drawable = create();
  drawableCache.set(key, drawable);
  while (drawableCache.size > MAX_CACHE_ENTRIES) {
    const oldest = drawableCache.keys().next().value;
    if (oldest === undefined) break;
    drawableCache.delete(oldest);
  }
  return drawable;
}

export function clearRoughDrawableCache(): void {
  drawableCache.clear();
  drawableReferenceCache = new WeakMap();
}

export function seededRandom(seedValue: string | number): () => number {
  let value = arrowSeed(seedValue) | 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let result = Math.imul(value ^ (value >>> 15), value | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function lightenHex(color: string, amount = 0.82): string {
  const normalized = color.trim().replace(/^#/, "");
  const hex = normalized.length === 3
    ? normalized.split("").map((character) => character + character).join("")
    : normalized;
  if (!/^[0-9a-f]{6}$/i.test(hex)) return "rgba(255,255,255,0.82)";
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const mixed = channels.map((channel) => Math.round(channel + (255 - channel) * amount));
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}
