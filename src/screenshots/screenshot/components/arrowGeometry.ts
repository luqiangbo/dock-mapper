import type { ArrowStyle, TextStyle } from "./annotationTypes";

export interface ArrowPoint {
  x: number;
  y: number;
}

export interface ArrowHeadGeometry {
  tip: ArrowPoint;
  baseCenter: ArrowPoint;
  leftBase: ArrowPoint;
  rightBase: ArrowPoint;
  filled: boolean;
}

export interface ArrowGeometry {
  length: number;
  headLength: number;
  direction: ArrowPoint;
  normal: ArrowPoint;
  shaftStart: ArrowPoint;
  shaftEnd: ArrowPoint;
  shaftPoints: ArrowPoint[];
  heads: ArrowHeadGeometry[];
  bounds: { x: number; y: number; width: number; height: number };
}

interface ArrowGeometryInput {
  start: ArrowPoint;
  end: ArrowPoint;
  lineWidth: number;
  canvasScale: number;
  headScale: number;
  style: ArrowStyle;
}

function pointAt(point: ArrowPoint, direction: ArrowPoint, distance: number): ArrowPoint {
  return { x: point.x + direction.x * distance, y: point.y + direction.y * distance };
}

function localPoint(
  start: ArrowPoint,
  direction: ArrowPoint,
  normal: ArrowPoint,
  along: number,
  across: number,
): ArrowPoint {
  return {
    x: start.x + direction.x * along + normal.x * across,
    y: start.y + direction.y * along + normal.y * across,
  };
}

function createHead(
  tip: ArrowPoint,
  direction: ArrowPoint,
  headLength: number,
  headWidth: number,
): ArrowHeadGeometry {
  const normal = { x: -direction.y, y: direction.x };
  const baseCenter = pointAt(tip, direction, -headLength);
  return {
    tip,
    baseCenter,
    leftBase: pointAt(baseCenter, normal, headWidth / 2),
    rightBase: pointAt(baseCenter, normal, -headWidth / 2),
    filled: false,
  };
}

function curvedPoints(
  start: ArrowPoint,
  direction: ArrowPoint,
  normal: ArrowPoint,
  length: number,
  style: ArrowStyle,
): ArrowPoint[] {
  if (style === "zigzag") {
    return [
      localPoint(start, direction, normal, 0, 0),
      localPoint(start, direction, normal, length * 0.24, length * 0.17),
      localPoint(start, direction, normal, length * 0.46, -length * 0.11),
      localPoint(start, direction, normal, length * 0.7, length * 0.16),
      localPoint(start, direction, normal, length, 0),
    ];
  }
  const steps = Math.max(8, Math.min(36, Math.ceil(length / 8)));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    let along = length * t;
    let across = 0;
    if (style === "curve") across = Math.sin(Math.PI * t) * length * 0.2;
    if (style === "sweep") across = -Math.sin(Math.PI * t) * length * 0.3 * (0.45 + t);
    if (style === "loop") {
      along += Math.sin(t * Math.PI * 2) * Math.sin(Math.PI * t) * length * 0.18;
      across = Math.sin(t * Math.PI * 2.15) * length * 0.24 * Math.sin(Math.PI * t);
    }
    return localPoint(start, direction, normal, along, across);
  });
}

function geometryBounds(points: ArrowPoint[]): ArrowGeometry["bounds"] {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(1, Math.max(...xs) - x),
    height: Math.max(1, Math.max(...ys) - y),
  };
}

export function calculateArrowGeometry(input: ArrowGeometryInput): ArrowGeometry | null {
  const dx = input.end.x - input.start.x;
  const dy = input.end.y - input.start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;
  const direction = { x: dx / length, y: dy / length };
  const normal = { x: -direction.y, y: direction.x };
  const canvasScale = Math.max(0.01, input.canvasScale);
  const headScale = Math.max(0.01, input.headScale);
  const desiredHeadLength = Math.max(input.lineWidth * 4.4, 13 * canvasScale) * headScale;
  const headLength = Math.min(desiredHeadLength, length * 0.42);
  const headWidth = headLength * (input.style === "block" ? 1.15 : 1);
  const head = createHead(input.end, direction, headLength, headWidth);
  const shaftStart = input.start;
  const shaftEnd = pointAt(head.baseCenter, direction, Math.min(input.lineWidth, headLength * 0.12));
  const shaftLength = Math.hypot(shaftEnd.x - shaftStart.x, shaftEnd.y - shaftStart.y);
  const shaftPoints = curvedPoints(shaftStart, direction, normal, shaftLength, input.style);
  const bounds = geometryBounds([...shaftPoints, head.tip, head.leftBase, head.rightBase]);
  return { length, headLength, direction, normal, shaftStart, shaftEnd, shaftPoints, heads: [head], bounds };
}

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
  let value = seed || 0x9e3779b9;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function roughen(points: ArrowPoint[], random: () => number, amount: number): ArrowPoint[] {
  return points.map((point, index) => index === 0 || index === points.length - 1 ? point : {
    x: point.x + (random() - 0.5) * amount,
    y: point.y + (random() - 0.5) * amount,
  });
}

function strokePath(context: CanvasRenderingContext2D, points: ArrowPoint[], close = false): void {
  if (!points[0]) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  if (close) context.closePath();
  context.stroke();
}

function blockOutline(geometry: ArrowGeometry, lineWidth: number): ArrowPoint[] {
  const half = Math.max(lineWidth * 1.6, geometry.headLength * 0.14);
  const head = geometry.heads[0];
  return [
    pointAt(geometry.shaftStart, geometry.normal, half),
    pointAt(head.baseCenter, geometry.normal, half),
    head.leftBase,
    head.tip,
    head.rightBase,
    pointAt(head.baseCenter, geometry.normal, -half),
    pointAt(geometry.shaftStart, geometry.normal, -half),
  ];
}

function drawCrayonPath(
  context: CanvasRenderingContext2D,
  points: ArrowPoint[],
  seed: number,
  canvasScale: number,
  close = false,
): void {
  const originalWidth = context.lineWidth;
  const passes = [
    { alpha: 0.34, width: 1.25, jitter: 1.6 },
    { alpha: 0.46, width: 0.86, jitter: 0.9 },
    { alpha: 0.3, width: 0.56, jitter: 2.2 },
  ];
  passes.forEach((pass, index) => {
    const random = randomSource(seed + index * 7919);
    context.globalAlpha = pass.alpha;
    context.lineWidth = Math.max(0.7 * canvasScale, originalWidth * pass.width);
    strokePath(context, roughen(points, random, pass.jitter * canvasScale), close);
  });
  const random = randomSource(seed ^ 0xa5a5a5a5);
  context.globalAlpha = 0.28;
  context.fillStyle = context.strokeStyle;
  points.forEach((point) => {
    if (random() < 0.28) return;
    const size = Math.max(0.7, originalWidth * (0.12 + random() * 0.14));
    context.fillRect(
      point.x + (random() - 0.5) * originalWidth * 1.8,
      point.y + (random() - 0.5) * originalWidth * 1.8,
      size,
      size,
    );
  });
  context.globalAlpha = 1;
  context.lineWidth = originalWidth;
}

function fontValue(style: TextStyle): string {
  const family = style.font === "serif" ? "Georgia, serif" : style.font === "mono" ? "Consolas, monospace" : '"Segoe UI", sans-serif';
  return `${style.bold ? 700 : 400} ${style.fontSize}px ${family}`;
}

function drawLegacyLabel(context: CanvasRenderingContext2D, geometry: ArrowGeometry, label: string, style: TextStyle): void {
  strokePath(context, geometry.shaftPoints);
  context.font = fontValue(style);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = style.color;
  context.fillText(label, (geometry.shaftStart.x + geometry.shaftEnd.x) / 2, (geometry.shaftStart.y + geometry.shaftEnd.y) / 2);
}

export function drawArrow(
  context: CanvasRenderingContext2D,
  start: ArrowPoint,
  end: ArrowPoint,
  style: ArrowStyle,
  headScale: number,
  canvasScale: number,
  label = "",
  labelStyle?: TextStyle,
  textureSeed: string | number = 0,
): void {
  const geometry = calculateArrowGeometry({ start, end, lineWidth: context.lineWidth, canvasScale, headScale, style });
  if (!geometry) return;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  if (style === "label" && label && labelStyle) {
    drawLegacyLabel(context, geometry, label, labelStyle);
  } else {
    const seed = arrowSeed(`${textureSeed}:${style}`);
    if (style === "block") {
      drawCrayonPath(context, blockOutline(geometry, context.lineWidth), seed, canvasScale, true);
    } else {
      drawCrayonPath(context, geometry.shaftPoints, seed, canvasScale);
      const head = geometry.heads[0];
      drawCrayonPath(context, [head.leftBase, head.tip, head.rightBase], seed ^ 0x45d9f3b, canvasScale);
    }
  }
  context.restore();
}
