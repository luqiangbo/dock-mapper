import { normalizeArrowStyle, type ArrowPreset, type ArrowStyle } from "./annotationTypes";

export interface ArrowPoint {
  x: number;
  y: number;
}
export interface ArrowStroke {
  points: ArrowPoint[];
  closed: boolean;
  taper: boolean;
}
export interface ArrowHeadGeometry {
  tip: ArrowPoint;
  baseCenter: ArrowPoint;
  leftBase: ArrowPoint;
  rightBase: ArrowPoint;
  filled: boolean;
}
export interface ArrowGeometry {
  style: ArrowPreset;
  length: number;
  /** Effective body width; short drags compress it together with the head. */
  width: number;
  headLength: number;
  direction: ArrowPoint;
  normal: ArrowPoint;
  shaftStart: ArrowPoint;
  shaftEnd: ArrowPoint;
  shaftPoints: ArrowPoint[];
  heads: ArrowHeadGeometry[];
  /** One closed silhouette shared by every material, selection box and export. */
  contours: ArrowPoint[][];
  strokes: ArrowStroke[];
  bounds: { x: number; y: number; width: number; height: number };
}
export interface ArrowGeometryInput {
  start: ArrowPoint;
  end: ArrowPoint;
  /** Physical pixels; the toolbar converts logical widths exactly once. */
  lineWidth: number;
  style: ArrowStyle;
}

/** Below this drag distance an arrow has no readable shape, so none is created. */
export const MIN_ARROW_LENGTH = 4;

export function arrowDragLength(start: ArrowPoint, end: ArrowPoint): number {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  return Number.isFinite(length) ? length : 0;
}

export function hasVisibleArrowLength(start: ArrowPoint, end: ArrowPoint): boolean {
  return arrowDragLength(start, end) >= MIN_ARROW_LENGTH;
}

const add = (p: ArrowPoint, v: ArrowPoint, s: number): ArrowPoint => ({
  x: p.x + v.x * s,
  y: p.y + v.y * s,
});
function unit(a: ArrowPoint, b: ArrowPoint): ArrowPoint {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  return distance ? { x: (b.x - a.x) / distance, y: (b.y - a.y) / distance } : { x: 1, y: 0 };
}
/** Offset a polyline; bevel sharp outer joins instead of extending unbounded miters. */
function rail(points: ArrowPoint[], half: number, side: number): ArrowPoint[] {
  return points.flatMap((p, i) => {
    const incoming = unit(points[Math.max(0, i - 1)], p);
    const outgoing = unit(p, points[Math.min(points.length - 1, i + 1)]);
    const a = i === 0 ? outgoing : incoming;
    const b = i === points.length - 1 ? incoming : outgoing;
    const na = { x: -a.y * side, y: a.x * side };
    const nb = { x: -b.y * side, y: b.x * side };
    const sum = { x: na.x + nb.x, y: na.y + nb.y };
    const d = Math.hypot(sum.x, sum.y);
    if (d < 1e-8) return [add(p, na, half), add(p, nb, half)];
    const n = { x: sum.x / d, y: sum.y / d };
    const projection = n.x * nb.x + n.y * nb.y;
    const miter = half / Math.max(0.001, projection);
    return miter <= half * 2 ? [add(p, n, miter)] : [add(p, na, half), add(p, nb, half)];
  });
}

/**
 * Every preset is one closed area: the body rails and the head share a single
 * perimeter, so no seam, overlap or interior gap can appear.  All dimensions
 * are proportional to the drag length and the requested width, which keeps the
 * shape identical at any DPI or cache resolution.
 */
export function calculateArrowGeometry(input: ArrowGeometryInput): ArrowGeometry | null {
  const { start, end } = input;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (
    ![start.x, start.y, end.x, end.y, input.lineWidth, length].every(Number.isFinite) ||
    length < 1e-6 ||
    input.lineWidth <= 0
  )
    return null;
  const style = normalizeArrowStyle(input.style);
  // The stair needs longer straight runs than the other presets before it can
  // carry the full width without folding over itself on a short drag.
  const width = Math.min(input.lineWidth, length * (style === "zigzag" ? 0.065 : 0.16));
  const half = width / 2;
  const headLength = Math.min(width * 2.8, length * 0.25);
  const neck = length - headLength;
  const headHalf = width * 1.25;
  const direction = unit(start, end);
  const normal = { x: -direction.y, y: direction.x };
  const world = (p: ArrowPoint) => ({
    x: start.x + p.x * direction.x + p.y * normal.x,
    y: start.y + p.x * direction.y + p.y * normal.y,
  });
  let spine: ArrowPoint[];
  let upper: ArrowPoint[];
  let lower: ArrowPoint[];
  if (style === "lightning") {
    // A tapered Z ribbon, deliberately different from the equal-width stair.
    // Both rails are offset from an x-monotone spine, so they never cross.
    spine = [
      { x: 0, y: 0 },
      { x: neck * 0.34, y: length * 0.1 },
      { x: neck * 0.62, y: -length * 0.1 },
      { x: neck, y: 0 },
    ];
    const widths = [width * 0.1, width * 0.85, width * 0.32, half];
    upper = spine.map((p, i) => ({ x: p.x, y: p.y - widths[i] }));
    lower = spine.map((p, i) => ({ x: p.x, y: p.y + widths[i] }));
  } else {
    spine =
      style === "zigzag"
        ? [
            { x: 0, y: 0 },
            { x: neck * 0.2, y: -neck * 0.2 },
            { x: neck * 0.4, y: 0 },
            { x: neck * 0.6, y: -neck * 0.2 },
            { x: neck * 0.8, y: 0 },
            { x: neck, y: 0 },
          ]
        : [{ x: style === "double" ? headLength : 0, y: 0 }, { x: neck, y: 0 }];
    upper = rail(spine, half, -1);
    lower = rail(spine, half, 1);
  }
  const contour = [
    ...upper,
    { x: neck, y: -headHalf },
    { x: length, y: 0 },
    { x: neck, y: headHalf },
    ...lower.reverse(),
  ];
  if (style === "double") {
    // The tail head mirrors the leading head across the arrow midpoint.
    contour.push({ x: headLength, y: headHalf }, { x: 0, y: 0 }, { x: headLength, y: -headHalf });
  } else if (style === "straight") {
    // Small tail corner arcs, retaining the nominal start point at x = 0.
    const radius = width * 0.18;
    contour[0] = { x: radius, y: -half };
    contour[contour.length - 1] = { x: radius, y: half };
    for (const [cy, begin] of [
      [half - radius, Math.PI / 2],
      [-half + radius, Math.PI],
    ] as const) {
      for (let i = 0; i <= 4; i++) {
        const angle = begin + (i * Math.PI) / 8;
        contour.push({ x: radius + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
      }
    }
  }
  // Explicit closure helps SVG previews and non-Canvas consumers use identical geometry.
  contour.push({ ...contour[0] });
  const points = contour.map(world);
  const heads: ArrowHeadGeometry[] = [
    {
      tip: { ...end },
      baseCenter: world({ x: neck, y: 0 }),
      leftBase: world({ x: neck, y: -headHalf }),
      rightBase: world({ x: neck, y: headHalf }),
      filled: true,
    },
  ];
  if (style === "double")
    heads.push({
      tip: { ...start },
      baseCenter: world({ x: headLength, y: 0 }),
      leftBase: world({ x: headLength, y: -headHalf }),
      rightBase: world({ x: headLength, y: headHalf }),
      filled: true,
    });
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  return {
    style,
    length,
    width,
    headLength,
    direction,
    normal,
    shaftStart: { ...start },
    shaftEnd: { ...end },
    shaftPoints: [{ ...start }, ...spine.map(world), { ...end }],
    heads,
    contours: [points],
    strokes: [{ points, closed: true, taper: false }],
    bounds: {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    },
  };
}

/** Shared by Canvas painting and vector toolbar thumbnails. */
export function arrowContourPath(geometry: ArrowGeometry): Path2D {
  const path = new Path2D();
  geometry.contours.forEach((points) => {
    points.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
    path.closePath();
  });
  return path;
}

export interface ArrowOutlinePreview {
  /** SVG path data for the same silhouette the canvas fills. */
  path: string;
  viewBox: string;
}

/** Toolbar thumbnails reuse the geometry layer instead of hand-drawn icons. */
export function arrowOutlinePreview(
  style: ArrowStyle,
  length = 96,
  lineWidth = 13,
): ArrowOutlinePreview {
  const geometry = calculateArrowGeometry({
    start: { x: 0, y: 0 },
    end: { x: length, y: 0 },
    lineWidth,
    style,
  });
  if (!geometry) return { path: "", viewBox: "0 0 1 1" };
  const round = (value: number) => Math.round(value * 100) / 100;
  const { x, y, width, height } = geometry.bounds;
  return {
    path: geometry.contours
      .map((points) => `M${points.map((p) => `${round(p.x)} ${round(p.y)}`).join("L")}Z`)
      .join(" "),
    viewBox: `${round(x - 1)} ${round(y - 1)} ${round(width + 2)} ${round(height + 2)}`,
  };
}
