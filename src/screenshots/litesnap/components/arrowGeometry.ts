import type { ArrowStyle } from "./annotationTypes";

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
  heads: ArrowHeadGeometry[];
}

interface ArrowGeometryInput {
  start: ArrowPoint;
  end: ArrowPoint;
  lineWidth: number;
  canvasScale: number;
  headScale: number;
  style: ArrowStyle;
}

function createHead(
  tip: ArrowPoint,
  direction: ArrowPoint,
  headLength: number,
  headWidth: number,
  filled: boolean,
): ArrowHeadGeometry {
  const normal = { x: -direction.y, y: direction.x };
  const baseCenter = {
    x: tip.x - direction.x * headLength,
    y: tip.y - direction.y * headLength,
  };
  return {
    tip,
    baseCenter,
    leftBase: {
      x: baseCenter.x + normal.x * (headWidth / 2),
      y: baseCenter.y + normal.y * (headWidth / 2),
    },
    rightBase: {
      x: baseCenter.x - normal.x * (headWidth / 2),
      y: baseCenter.y - normal.y * (headWidth / 2),
    },
    filled,
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
  const desiredHeadLength = Math.max(input.lineWidth * 4.8, 12 * canvasScale) * headScale;
  const maximumRatio = input.style === "double" ? 0.35 : 0.45;
  const headLength = Math.min(desiredHeadLength, length * maximumRatio);
  const headWidth = headLength;
  const endHead = createHead(
    input.end,
    direction,
    headLength,
    headWidth,
    input.style !== "outline",
  );
  const heads = [endHead];
  let shaftStart = input.start;
  let shaftEnd = endHead.baseCenter;

  if (input.style === "double") {
    const startHead = createHead(
      input.start,
      { x: -direction.x, y: -direction.y },
      headLength,
      headWidth,
      true,
    );
    heads.unshift(startHead);
    const overlap = Math.min(input.lineWidth / 2, headLength * 0.15);
    shaftStart = {
      x: startHead.baseCenter.x - direction.x * overlap,
      y: startHead.baseCenter.y - direction.y * overlap,
    };
    shaftEnd = {
      x: endHead.baseCenter.x + direction.x * overlap,
      y: endHead.baseCenter.y + direction.y * overlap,
    };
  } else if (input.style === "filled") {
    const overlap = Math.min(input.lineWidth / 2, headLength * 0.15);
    shaftEnd = {
      x: endHead.baseCenter.x + direction.x * overlap,
      y: endHead.baseCenter.y + direction.y * overlap,
    };
  }

  return { length, headLength, direction, normal, shaftStart, shaftEnd, heads };
}

export function drawArrow(
  context: CanvasRenderingContext2D,
  start: ArrowPoint,
  end: ArrowPoint,
  style: ArrowStyle,
  headScale: number,
  canvasScale: number,
): void {
  const geometry = calculateArrowGeometry({
    start,
    end,
    lineWidth: context.lineWidth,
    canvasScale,
    headScale,
    style,
  });
  if (!geometry) return;

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(geometry.shaftStart.x, geometry.shaftStart.y);
  context.lineTo(geometry.shaftEnd.x, geometry.shaftEnd.y);
  context.stroke();

  for (const head of geometry.heads) {
    context.beginPath();
    context.moveTo(head.tip.x, head.tip.y);
    context.lineTo(head.leftBase.x, head.leftBase.y);
    context.lineTo(head.rightBase.x, head.rightBase.y);
    context.closePath();
    if (head.filled) context.fill();
    else context.stroke();
  }
  context.restore();
}
