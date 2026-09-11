import type { ArrowPreset } from "./annotationTypes";
import type { ArrowBrushId } from "./arrowBrushPresets";
import type { ArrowGeometry, ArrowPoint } from "./arrowShapes";

export const ARROW_ASSEMBLY_VERSION = 1 as const;

export interface ArrowAssemblyVariation {
  version: typeof ARROW_ASSEMBLY_VERSION;
  seed: number;
  headLengthScale: number;
  leftHeadScale: number;
  rightHeadScale: number;
}

export interface ArrowLinePart {
  role: "shaft" | "head";
  start: ArrowPoint;
  end: ArrowPoint;
}

const BRUSH_VARIATION: Record<ArrowBrushId, number> = {
  solid: 0.62,
  marker: 0.75,
  highlighter: 0.58,
  "brush-pen": 1,
  pencil: 0.85,
  charcoal: 1.08,
  watercolor: 0.95,
  spray: 0.9,
  hatch: 0.7,
};

const COMPONENTS = [
  [0.06, 0.02, -0.02],
  [0, 0.06, -0.06],
  [-0.08, 0.03, 0.04],
  [0.05, -0.09, 0.09],
] as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function randomSource(seed: number): () => number {
  let value = seed | 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let result = Math.imul(value ^ (value >>> 15), value | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  const first = Math.max(Number.EPSILON, random());
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(Math.PI * 2 * random());
}

/** Samples only assembly proportions; the center axis is never perturbed. */
export function createArrowAssemblyVariation(
  style: ArrowPreset,
  brushId: ArrowBrushId,
  seed: number,
): ArrowAssemblyVariation {
  const features = [1, 1, 1];
  const random = randomSource(seed);
  const strength = BRUSH_VARIATION[brushId] * (style === "segmented" ? 0.78 : 1);
  for (const component of COMPONENTS) {
    const score = clamp(gaussian(random), -2.1, 2.1) * strength;
    component.forEach((weight, index) => {
      features[index] += weight * score;
    });
  }
  return {
    version: ARROW_ASSEMBLY_VERSION,
    seed: seed >>> 0,
    headLengthScale: clamp(features[0], 0.84, 1.16),
    leftHeadScale: clamp(features[1], 0.8, 1.2),
    rightHeadScale: clamp(features[2], 0.8, 1.2),
  };
}

export function arrowAssemblyKey(variation?: ArrowAssemblyVariation): string {
  return variation ? JSON.stringify(variation) : "standard";
}

function lerp(start: ArrowPoint, end: ArrowPoint, amount: number): ArrowPoint {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  };
}

/**
 * Arrows are assembled from independent straight primitives. Randomness may
 * change head proportions and pigment, but never bends the A-to-B axis.
 */
export function arrowLineParts(geometry: ArrowGeometry): ArrowLinePart[] {
  const start = geometry.shaftStart;
  const end = geometry.shaftEnd;
  const shaft: ArrowLinePart[] =
    geometry.style === "segmented"
      ? [
          { role: "shaft", start: lerp(start, end, 0), end: lerp(start, end, 0.27) },
          { role: "shaft", start: lerp(start, end, 0.36), end: lerp(start, end, 0.64) },
          { role: "shaft", start: lerp(start, end, 0.73), end: lerp(start, end, 1) },
        ]
      : [{ role: "shaft", start, end }];
  const heads = geometry.heads.flatMap<ArrowLinePart>((head) => [
    { role: "head", start: head.tip, end: head.leftBase },
    { role: "head", start: head.tip, end: head.rightBase },
  ]);
  return [...shaft, ...heads];
}
