import type { ArrowStyle, TextStyle } from "./annotationTypes";

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
  return style === "double";
}
function hasOpenEnd(style: ArrowStyle): boolean {
  return style === "chevron";
}
function headIsFilled(): boolean { return true; }

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
  const doubleEnded = hasStartHead(input.style);
  const headLength = Math.min(desiredHeadLength, length * (doubleEnded ? 0.35 : 0.45));
  const headWidth = headLength;
  const endHead = createHead(input.end, direction, headLength, headWidth, headIsFilled());
  const heads = [endHead];
  let shaftStart = input.start;
  let shaftEnd = endHead.baseCenter;
  if (hasStartHead(input.style)) {
    const startHead = createHead(input.start, { x: -direction.x, y: -direction.y }, headLength, headWidth, headIsFilled());
    heads.unshift(startHead);
    const overlap = Math.min(input.lineWidth / 2, headLength * 0.15);
    shaftStart = pointAt(startHead.baseCenter, direction, -overlap);
    shaftEnd = pointAt(endHead.baseCenter, direction, overlap);
  } else {
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
function drawBlockArrow(context: CanvasRenderingContext2D, geometry: ArrowGeometry): void {
  const { shaftStart, direction, normal, headLength } = geometry;
  const head = geometry.heads[geometry.heads.length - 1];
  const shaftHalf = Math.max(context.lineWidth * 1.3, headLength * 0.16);
  context.beginPath();
  context.moveTo(shaftStart.x + normal.x * shaftHalf, shaftStart.y + normal.y * shaftHalf);
  context.lineTo(head.baseCenter.x + normal.x * shaftHalf, head.baseCenter.y + normal.y * shaftHalf);
  context.lineTo(head.leftBase.x, head.leftBase.y);
  context.lineTo(head.tip.x, head.tip.y);
  context.lineTo(head.rightBase.x, head.rightBase.y);
  context.lineTo(head.baseCenter.x - normal.x * shaftHalf, head.baseCenter.y - normal.y * shaftHalf);
  context.lineTo(shaftStart.x - normal.x * shaftHalf, shaftStart.y - normal.y * shaftHalf);
  context.closePath();
  context.fill();
}

function fontValue(style: TextStyle): string {
  const family = style.font === "serif" ? "Georgia, serif" : style.font === "mono" ? "Consolas, monospace" : '"Segoe UI", sans-serif';
  return `${style.bold ? 700 : 400} ${style.fontSize}px ${family}`;
}

function drawLabeledShaft(context: CanvasRenderingContext2D, geometry: ArrowGeometry, label: string, style: TextStyle): void {
  const midpoint = {
    x: (geometry.shaftStart.x + geometry.shaftEnd.x) / 2,
    y: (geometry.shaftStart.y + geometry.shaftEnd.y) / 2,
  };
  context.save();
  context.font = fontValue(style);
  const textWidth = context.measureText(label).width;
  const halfGap = Math.abs(geometry.direction.x) * (textWidth / 2 + 6)
    + Math.abs(geometry.direction.y) * (style.fontSize / 2 + 5);
  const firstEnd = pointAt(midpoint, geometry.direction, -halfGap);
  const secondStart = pointAt(midpoint, geometry.direction, halfGap);
  context.beginPath();
  context.moveTo(geometry.shaftStart.x, geometry.shaftStart.y);
  context.lineTo(firstEnd.x, firstEnd.y);
  context.moveTo(secondStart.x, secondStart.y);
  context.lineTo(geometry.shaftEnd.x, geometry.shaftEnd.y);
  context.stroke();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = style.color;
  context.strokeStyle = style.strokeColor;
  context.lineWidth = style.strokeWidth;
  if (style.strokeWidth > 0) context.strokeText(label, midpoint.x, midpoint.y);
  context.fillText(label, midpoint.x, midpoint.y);
  context.restore();
}

export function drawArrow(context: CanvasRenderingContext2D, start: ArrowPoint, end: ArrowPoint, style: ArrowStyle, headScale: number, canvasScale: number, label = "", labelStyle?: TextStyle): void {
  const geometry = calculateArrowGeometry({ start, end, lineWidth: context.lineWidth, canvasScale, headScale, style });
  if (!geometry) return;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  if (style === "block") {
    drawBlockArrow(context, geometry);
    context.restore();
    return;
  }
  if (style === "label" && label && labelStyle) {
    drawLabeledShaft(context, geometry, label, labelStyle);
  } else {
    context.beginPath();
    context.moveTo(geometry.shaftStart.x, geometry.shaftStart.y);
    context.lineTo(geometry.shaftEnd.x, geometry.shaftEnd.y);
    context.stroke();
  }

  if (hasStartHead(style) && geometry.heads[0]) drawTriangle(context, geometry.heads[0], true);
  const endHead = geometry.heads[geometry.heads.length - 1];
  if (hasOpenEnd(style)) drawChevron(context, endHead);
  else drawTriangle(context, endHead, true);
  context.restore();
}
