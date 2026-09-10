import { normalizeArrowEffect, type ArrowEffect, type GradientStop } from "./annotationTypes";
import {
  arrowContourPath,
  type ArrowGeometry,
  type ArrowPoint,
  type ArrowStroke,
} from "./arrowShapes";
import { createCrayonGrains, paintCrayonGrains } from "./crayonBrush";
import {
  colorChannels,
  createCanvasPaint,
  normalizeGradientStops,
  rgbColor,
} from "./annotationPaint";

/**
 * Materials never reshape an arrow: the geometry layer owns the silhouette and
 * every brush only fills or subtracts pigment inside it.  A brush may ask for
 * extra room outside the outline for antialiasing and soft edges only.
 */
const BRUSH_BLEED: Record<ArrowEffect, number> = {
  classic: 0.08,
  gradient: 0.08,
  marker: 0.18,
  crayon: 0.24,
};

export function arrowEffectPadding(effect: ArrowEffect | undefined, width: number): number {
  return Math.max(2, width * BRUSH_BLEED[normalizeArrowEffect(effect)]);
}

/** One composite alpha for the whole arrow, so strokes never darken on overlap. */
export function arrowEffectOpacity(effect: ArrowEffect | undefined): number {
  return normalizeArrowEffect(effect) === "marker" ? 0.62 : 1;
}

function noise(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function arrowColorVariants(color: string): {
  base: number[];
  side: number[];
  end: string;
} {
  const base = colorChannels(color);
  const rgb = base.map((v) => v / 255);
  const max = Math.max(...rgb),
    min = Math.min(...rgb),
    delta = max - min;
  const lightness = (max + min) / 2;
  let end: string;
  if (delta < 0.04) {
    const shade = Math.round(
      (lightness > 0.5 ? Math.max(0, lightness - 0.35) : Math.min(1, lightness + 0.45)) * 255,
    );
    end = `rgb(${shade}, ${shade}, ${shade})`;
  } else {
    const hue =
      (max === rgb[0]
        ? (rgb[1] - rgb[2]) / delta
        : max === rgb[1]
          ? (rgb[2] - rgb[0]) / delta + 2
          : (rgb[0] - rgb[1]) / delta + 4) * 60;
    const saturation = delta / (1 - Math.abs(2 * lightness - 1));
    end = `hsl(${(hue + 410) % 360} ${saturation * 100}% ${Math.max(35, lightness * 100)}%)`;
  }
  return { base, side: base.map((v) => Math.round(v * 0.58)), end };
}

export interface ArrowPaintOptions {
  /** Effective body width in physical pixels. */
  width: number;
  /** Device pixels per scene unit; changes texture detail, never the shape. */
  scale: number;
  seed: number;
  color: string;
  effect?: ArrowEffect;
  gradientStops?: GradientStop[];
}

export interface ArrowMaterial {
  effect: ArrowEffect;
  geometry: ArrowGeometry;
  /** Exactly the geometry silhouette; brushes must not replace it. */
  outline: ArrowPoint[][];
  /** The silhouette expressed as closed strokes, for particle brushes. */
  strokes: ArrowStroke[];
  width: number;
  scale: number;
  seed: number;
  color: string;
  gradientStops?: GradientStop[];
  opacity: number;
}

/** Split so that a colour change repaints the material over the same geometry. */
export function createArrowMaterial(
  geometry: ArrowGeometry,
  options: ArrowPaintOptions,
): ArrowMaterial {
  const effect = normalizeArrowEffect(options.effect);
  return {
    effect,
    geometry,
    outline: geometry.contours,
    strokes: geometry.contours.map((points) => ({ points, closed: true, taper: false })),
    width: Math.max(0.5, options.width),
    scale: Math.max(0.25, options.scale),
    seed: options.seed,
    color: options.color,
    gradientStops: normalizeGradientStops(options.gradientStops),
    opacity: arrowEffectOpacity(effect),
  };
}

/** Tail-to-tip paint; the gradient preset reuses the solid filler. */
export function createArrowFill(
  context: CanvasRenderingContext2D,
  material: ArrowMaterial,
): string | CanvasGradient {
  const { shaftStart: tail, shaftEnd: tip } = material.geometry;
  if (material.gradientStops?.length)
    return createCanvasPaint(
      context,
      material.color,
      material.gradientStops,
      tail.x,
      tail.y,
      tip.x,
      tip.y,
    );
  if (material.effect !== "gradient") return material.color;
  const variants = arrowColorVariants(material.color);
  const gradient = context.createLinearGradient(tail.x, tail.y, tip.x, tip.y);
  gradient.addColorStop(0, rgbColor(variants.side));
  gradient.addColorStop(0.55, material.color);
  gradient.addColorStop(1, variants.end);
  return gradient;
}

type ArrowBrush = (
  context: CanvasRenderingContext2D,
  material: ArrowMaterial,
  outline: Path2D,
  fill: string | CanvasGradient,
) => void;

const solid: ArrowBrush = (context, _material, outline, fill) => {
  context.fillStyle = fill;
  context.fill(outline);
};

/** Grains along the perimeter and the spine, all clipped inside the outline. */
function crayonStrokes(material: ArrowMaterial): ArrowStroke[] {
  return [
    ...material.strokes,
    { points: material.geometry.shaftPoints, closed: false, taper: false },
  ];
}

const crayon: ArrowBrush = (context, material, outline, fill) => {
  const { width, scale, seed } = material;
  const strokes = crayonStrokes(material);
  context.clip(outline);
  context.fillStyle = fill;
  context.globalAlpha = 0.9;
  context.fill(outline);
  // Dry patches let the screenshot show through without touching the outline.
  context.globalCompositeOperation = "destination-out";
  context.globalAlpha = 0.5;
  paintCrayonGrains(context, createCrayonGrains(strokes, width * 0.8, scale, seed ^ 0x9e37));
  context.globalCompositeOperation = "source-over";
  const variants = arrowColorVariants(material.color);
  context.globalAlpha = 0.42;
  context.fillStyle = material.gradientStops?.length ? fill : rgbColor(variants.side);
  paintCrayonGrains(context, createCrayonGrains(strokes, width, scale, seed));
  context.globalAlpha = 0.3;
  context.fillStyle = material.gradientStops?.length
    ? fill
    : rgbColor(variants.base.map((value) => value + (255 - value) * 0.45));
  paintCrayonGrains(context, createCrayonGrains(strokes, width * 0.62, scale, seed ^ 0x51c3));
};

/**
 * A flat translucent body with fine streaks along the drag direction.  The
 * streaks subtract pigment instead of stacking extra layers, so the whole
 * arrow keeps the single composite alpha applied when it is drawn.
 */
const marker: ArrowBrush = (context, material, outline, fill) => {
  const { geometry, width, scale, seed } = material;
  context.clip(outline);
  context.fillStyle = fill;
  context.fill(outline);
  // Streaks span exactly the outline's own extent across the drag direction.
  const laterals = geometry.contours
    .flat()
    .map(
      (point) =>
        (point.x - geometry.shaftStart.x) * geometry.normal.x +
        (point.y - geometry.shaftStart.y) * geometry.normal.y,
    );
  const near = Math.min(...laterals) - width * 0.1;
  const far = Math.max(...laterals) + width * 0.1;
  const reach = Math.max(geometry.bounds.width, geometry.bounds.height) + width * 2;
  const spacing = Math.max(scale * 1.4, width * 0.26);
  const count = Math.min(64, Math.max(4, Math.round((far - near) / spacing)));
  context.globalCompositeOperation = "destination-out";
  context.strokeStyle = "#000000";
  context.lineCap = "butt";
  for (let index = 0; index <= count; index += 1) {
    const shade = noise(index, 3, seed);
    if (shade > 0.42) continue;
    const lateral = near + ((far - near) * index) / count;
    const axis = {
      x: geometry.shaftStart.x + geometry.normal.x * lateral,
      y: geometry.shaftStart.y + geometry.normal.y * lateral,
    };
    context.globalAlpha = 0.12 + shade * 0.34;
    context.lineWidth = Math.max(scale * 0.6, width * (0.05 + shade * 0.12));
    context.beginPath();
    context.moveTo(axis.x - geometry.direction.x * reach, axis.y - geometry.direction.y * reach);
    context.lineTo(axis.x + geometry.direction.x * reach, axis.y + geometry.direction.y * reach);
    context.stroke();
  }
  context.globalCompositeOperation = "source-over";
};

const BRUSHES: Record<ArrowEffect, ArrowBrush> = {
  classic: solid,
  gradient: solid,
  crayon,
  marker,
};

/**
 * Paint one arrow in scene coordinates.  Callers own caching and compositing;
 * the returned pixels are opaque wherever the brush laid down pigment, so the
 * uniform effect alpha can change without repainting.
 */
export function paintArrowEffect(
  context: CanvasRenderingContext2D,
  geometry: ArrowGeometry,
  options: ArrowPaintOptions,
): void {
  const material = createArrowMaterial(geometry, options);
  const outline = arrowContourPath(geometry);
  context.save();
  try {
    context.lineJoin = "round";
    BRUSHES[material.effect](context, material, outline, createArrowFill(context, material));
  } finally {
    context.restore();
  }
}
