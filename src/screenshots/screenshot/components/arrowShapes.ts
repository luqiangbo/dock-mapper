import type { ArrowStyle } from "./annotationTypes";
import type { ArrowAssemblyVariation } from "./arrowAssembly";

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
  style: ArrowStyle;
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
  /** Conservative silhouette used for selection and cache bounds. */
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
  assembly?: ArrowAssemblyVariation;
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
 * Builds conservative bounds and endpoint/head geometry for the straight-part
 * assembler. All dimensions remain proportional to drag length and width.
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
  const style: ArrowStyle = input.style;
  const width = Math.min(input.lineWidth, length * 0.16);
  const half = width / 2;
  const variation = input.assembly;
  const headLength = Math.min(
    Math.min(width * 2.8, length * 0.25) * (variation?.headLengthScale ?? 1),
    length * 0.28,
  );
  const neck = length - headLength;
  const leftHeadHalf = width * 1.25 * (variation?.leftHeadScale ?? 1);
  const rightHeadHalf = width * 1.25 * (variation?.rightHeadScale ?? 1);
  const headBaseY = 0;
  const direction = unit(start, end);
  const normal = { x: -direction.y, y: direction.x };
  const world = (p: ArrowPoint) => ({
    x: start.x + p.x * direction.x + p.y * normal.x,
    y: start.y + p.x * direction.y + p.y * normal.y,
  });
  let spine: ArrowPoint[];
  let upper: ArrowPoint[];
  let lower: ArrowPoint[];
  spine = [
    { x: style === "double" ? headLength : 0, y: 0 },
    { x: neck, y: 0 },
  ];
  upper = rail(spine, half, -1);
  lower = rail(spine, half, 1);
  const contour = [
    ...upper,
    { x: neck, y: headBaseY - leftHeadHalf },
    { x: length, y: 0 },
    { x: neck, y: headBaseY + rightHeadHalf },
    ...lower.reverse(),
  ];
  if (style === "double") {
    // The tail head mirrors the leading head across the arrow midpoint.
    const tailY = spine[0].y;
    contour.push(
      { x: headLength, y: tailY + leftHeadHalf },
      { x: 0, y: 0 },
      { x: headLength, y: tailY - rightHeadHalf },
    );
  } else {
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
      baseCenter: world({ x: neck, y: headBaseY }),
      leftBase: world({ x: neck, y: headBaseY - leftHeadHalf }),
      rightBase: world({ x: neck, y: headBaseY + rightHeadHalf }),
      filled: true,
    },
  ];
  if (style === "double")
    heads.push({
      tip: { ...start },
      baseCenter: world(spine[0]),
      leftBase: world({ x: headLength, y: spine[0].y + leftHeadHalf }),
      rightBase: world({ x: headLength, y: spine[0].y - rightHeadHalf }),
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
    shaftPoints: [
      ...(style === "double" ? [{ ...start }] : []),
      ...spine.map(world),
      { ...end },
    ],
    heads,
    contours: [points],
    strokes: [{ points, closed: true, taper: false }],
    bounds: {
      x: Math.min(...xs) - half,
      y: Math.min(...ys) - half,
      width: Math.max(...xs) - Math.min(...xs) + width,
      height: Math.max(...ys) - Math.min(...ys) + width,
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
