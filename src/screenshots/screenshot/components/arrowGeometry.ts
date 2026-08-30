import type { ArrowStyle } from "./annotationTypes";

export interface ArrowPoint { x: number; y: number; }
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
  heads: ArrowHeadGeometry[];
}
interface ArrowGeometryInput {
  start: ArrowPoint; end: ArrowPoint; lineWidth: number; canvasScale: number; headScale: number; style: ArrowStyle;
}

function pointAt(point: ArrowPoint, direction: ArrowPoint, distance: number): ArrowPoint {
  return { x: point.x + direction.x * distance, y: point.y + direction.y * distance };
}
function createHead(tip: ArrowPoint, direction: ArrowPoint, headLength: number, headWidth: number, filled: boolean): ArrowHeadGeometry {
  const normal = { x: -direction.y, y: direction.x };
  const baseCenter = pointAt(tip, direction, -headLength);
  return {
    tip, baseCenter,
    leftBase: pointAt(baseCenter, normal, headWidth / 2),
    rightBase: pointAt(baseCenter, normal, -headWidth / 2),
    filled,
  };
}
function hasStartHead(style: ArrowStyle): boolean {
  return style === "double" || style === "double-outline";
}
function hasStartGeometry(style: ArrowStyle): boolean {
  return hasStartHead(style) || style === "double-chevron";
}
function hasOpenEnd(style: ArrowStyle): boolean {
  return style === "chevron" || style === "double-chevron";
}
function hasOpenStart(style: ArrowStyle): boolean { return style === "double-chevron"; }
function headIsFilled(style: ArrowStyle): boolean { return style !== "outline" && style !== "double-outline"; }

export function calculateArrowGeometry(input: ArrowGeometryInput): ArrowGeometry | null {
  const dx = input.end.x - input.start.x;
  const dy = input.end.y - input.start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;
  const direction = { x: dx / length, y: dy / length };
  const normal = { x: -direction.y, y: direction.x };
  const canvasScale = Math.max(0.01, input.canvasScale);
  const headScale = Math.max(0.01, input.headScale);
  const desiredHeadLength = Math.max(input.lineWidth * 4.8, 12 * canvasScale) * headScale;
  const doubleEnded = hasStartGeometry(input.style);
  const headLength = Math.min(desiredHeadLength, length * (doubleEnded ? 0.35 : 0.45));
  const headWidth = input.style === "narrow" ? headLength * 0.55 : headLength;
  const endHead = createHead(input.end, direction, headLength, headWidth, headIsFilled(input.style));
  const heads = [endHead];
  let shaftStart = input.start;
  let shaftEnd = endHead.baseCenter;
  if (hasStartGeometry(input.style)) {
    const startHead = createHead(input.start, { x: -direction.x, y: -direction.y }, headLength, headWidth, headIsFilled(input.style));
    heads.unshift(startHead);
    const overlap = Math.min(input.lineWidth / 2, headLength * 0.15);
    shaftStart = pointAt(startHead.baseCenter, direction, -overlap);
    shaftEnd = pointAt(endHead.baseCenter, direction, overlap);
  } else if (input.style === "filled" || input.style === "narrow" || input.style.startsWith("start-")) {
    shaftEnd = pointAt(endHead.baseCenter, direction, Math.min(input.lineWidth / 2, headLength * 0.15));
  }
  return { length, headLength, direction, normal, shaftStart, shaftEnd, heads };
}

function drawTriangle(context: CanvasRenderingContext2D, head: ArrowHeadGeometry, filled: boolean): void {
  context.beginPath();
  context.moveTo(head.tip.x, head.tip.y);
  context.lineTo(head.leftBase.x, head.leftBase.y);
  context.lineTo(head.rightBase.x, head.rightBase.y);
  context.closePath();
  if (filled) context.fill(); else context.stroke();
}
function drawChevron(context: CanvasRenderingContext2D, head: ArrowHeadGeometry): void {
  context.beginPath();
  context.moveTo(head.leftBase.x, head.leftBase.y);
  context.lineTo(head.tip.x, head.tip.y);
  context.lineTo(head.rightBase.x, head.rightBase.y);
  context.stroke();
}
function drawCircle(context: CanvasRenderingContext2D, center: ArrowPoint, radius: number, filled: boolean): void {
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  if (filled) context.fill(); else context.stroke();
}
function drawStartMarker(context: CanvasRenderingContext2D, style: ArrowStyle, geometry: ArrowGeometry): void {
  const { shaftStart: start, normal, direction, headLength } = geometry;
  const radius = Math.max(context.lineWidth * 1.45, headLength * 0.32);
  if (style === "start-dot" || style === "start-dot-outline") {
    drawCircle(context, start, radius, style === "start-dot");
  } else if (style === "start-bar") {
    context.beginPath();
    context.moveTo(start.x + normal.x * radius, start.y + normal.y * radius);
    context.lineTo(start.x - normal.x * radius, start.y - normal.y * radius);
    context.stroke();
  } else if (style === "start-diamond") {
    context.beginPath();
    context.moveTo(start.x - direction.x * radius, start.y - direction.y * radius);
    context.lineTo(start.x + normal.x * radius, start.y + normal.y * radius);
    context.lineTo(start.x + direction.x * radius, start.y + direction.y * radius);
    context.lineTo(start.x - normal.x * radius, start.y - normal.y * radius);
    context.closePath();
    context.fill();
  } else if (style === "start-tail") {
    const base = pointAt(start, direction, radius * 1.15);
    context.beginPath();
    context.moveTo(base.x + normal.x * radius, base.y + normal.y * radius);
    context.lineTo(start.x - direction.x * radius * 0.7, start.y - direction.y * radius * 0.7);
    context.lineTo(base.x - normal.x * radius, base.y - normal.y * radius);
    context.stroke();
  }
}

export function drawArrow(context: CanvasRenderingContext2D, start: ArrowPoint, end: ArrowPoint, style: ArrowStyle, headScale: number, canvasScale: number): void {
  const geometry = calculateArrowGeometry({ start, end, lineWidth: context.lineWidth, canvasScale, headScale, style });
  if (!geometry) return;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(geometry.shaftStart.x, geometry.shaftStart.y);
  context.lineTo(geometry.shaftEnd.x, geometry.shaftEnd.y);
  context.stroke();

  if (hasOpenStart(style) && geometry.heads[0]) drawChevron(context, geometry.heads[0]);
  else if (hasStartHead(style) && geometry.heads[0]) drawTriangle(context, geometry.heads[0], headIsFilled(style));
  const endHead = geometry.heads[geometry.heads.length - 1];
  if (hasOpenEnd(style)) drawChevron(context, endHead);
  else drawTriangle(context, endHead, headIsFilled(style));
  if (style.startsWith("start-")) drawStartMarker(context, style, geometry);
  context.restore();
}
