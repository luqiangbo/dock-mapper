import type { ArrowPoint, ArrowStroke } from "./arrowShapes";

export function arrowSeed(value: string | number): number {
  const text = String(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function randomSource(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let result = Math.imul(value ^ (value >>> 15), value | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}
export interface CrayonGrain {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

/** Equidistant samples avoid gaps on long segments and dark knots at curve vertices. */
function samples(
  stroke: ArrowStroke,
  spacing: number,
): Array<ArrowPoint & { t: number; nx: number; ny: number }> {
  const points = stroke.closed ? [...stroke.points, stroke.points[0]] : stroke.points;
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const count = Math.max(1, Math.ceil(total / spacing));
  const result: Array<ArrowPoint & { t: number; nx: number; ny: number }> = [];
  let segment = 0,
    traveled = 0;
  for (let index = 0; index <= count; index += 1) {
    const distance = (index / count) * total;
    while (segment < lengths.length - 1 && traveled + lengths[segment] < distance)
      traveled += lengths[segment++];
    const a = points[segment],
      b = points[segment + 1];
    if (!a || !b) continue;
    const length = lengths[segment] || 1;
    const t = Math.min(1, (distance - traveled) / length);
    result.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      t: index / count,
      nx: -(b.y - a.y) / length,
      ny: (b.x - a.x) / length,
    });
  }
  return result;
}

/** Pure local-space brush instructions; no random state depends on redraw timing. */
export function createCrayonGrains(
  strokes: ArrowStroke[],
  width: number,
  scale: number,
  seed: number,
): CrayonGrain[] {
  const grains: CrayonGrain[] = [];
  const pixel = Math.max(0.25, scale);
  const random = randomSource(seed);
  strokes.forEach((stroke) => {
    const phase = random() * Math.PI * 2;
    const spacing = Math.max(pixel * 0.55, width * 0.12);
    for (const point of samples(stroke, spacing)) {
      const pressure =
        0.72 + 0.18 * Math.sin(point.t * 14 + phase) + 0.1 * Math.sin(point.t * 37 + phase);
      const taper = stroke.taper ? Math.min(1, 0.12 + point.t * 5) : 1;
      const localWidth = width * pressure * taper;
      const dryPatch = Math.sin(point.t * 23 + phase) > 0.87;
      const density = dryPatch ? 0.18 : 0.76 + 0.2 * Math.sin(point.t * 21 + phase) ** 2;
      const count = Math.max(6, Math.ceil((width / pixel) * 3.8));
      const wobble = Math.sin(point.t * 19 + phase) * width * 0.09;
      for (let index = 0; index < count; index += 1) {
        const across = (random() - 0.5) * localWidth;
        const along = (random() - 0.5) * spacing * 1.8;
        const radius = pixel * (0.2 + random() * 0.6);
        const alpha = (0.65 + random() * 0.35) * taper;
        if (random() > density || (Math.abs(across) > localWidth * 0.36 && random() > 0.6))
          continue;
        grains.push({
          x: point.x + point.nx * (across + wobble) + point.ny * along,
          y: point.y + point.ny * (across + wobble) - point.nx * along,
          radius,
          alpha,
        });
      }
    }
  });
  return grains;
}

export function paintCrayonGrains(context: CanvasRenderingContext2D, grains: CrayonGrain[]): void {
  // Quantized opacity allows batching all particles into only four fills.
  // The caller's alpha stays in charge of how strong the whole pass is.
  const base = context.globalAlpha;
  for (let layer = 0; layer < 4; layer += 1) {
    context.globalAlpha = (base * (layer + 1)) / 4;
    context.beginPath();
    for (const grain of grains) {
      if (Math.min(3, Math.floor(grain.alpha * 4)) !== layer) continue;
      context.moveTo(grain.x + grain.radius, grain.y);
      context.arc(grain.x, grain.y, grain.radius, 0, Math.PI * 2);
    }
    context.fill();
  }
  context.globalAlpha = base;
}
