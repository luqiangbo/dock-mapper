import rough from "roughjs";
import type { Drawable, Op } from "roughjs/bin/core";
import type { FrameShape } from "./annotationTypes";

export interface RoughPoint {
  x: number;
  y: number;
}

interface RoughBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function cubic(
  start: RoughPoint,
  controlA: RoughPoint,
  controlB: RoughPoint,
  end: RoughPoint,
  amount: number,
): RoughPoint {
  const inverse = 1 - amount;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * amount * controlA.x +
      3 * inverse * amount ** 2 * controlB.x +
      amount ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * amount * controlA.y +
      3 * inverse * amount ** 2 * controlB.y +
      amount ** 3 * end.y,
  };
}

function opPoint(op: Op): RoughPoint {
  return { x: op.data[op.data.length - 2], y: op.data[op.data.length - 1] };
}

function drawableLines(drawable: Drawable): RoughPoint[][] {
  const lines: RoughPoint[][] = [];
  for (const set of drawable.sets.filter(({ type }) => type === "path")) {
    let current: RoughPoint[] = [];
    let cursor: RoughPoint = { x: 0, y: 0 };
    for (const op of set.ops) {
      if (op.op === "move") {
        if (current.length > 1) lines.push(current);
        cursor = opPoint(op);
        current = [cursor];
      } else if (op.op === "lineTo") {
        cursor = opPoint(op);
        current.push(cursor);
      } else {
        const controlA = { x: op.data[0], y: op.data[1] };
        const controlB = { x: op.data[2], y: op.data[3] };
        const end = { x: op.data[4], y: op.data[5] };
        for (let step = 1; step <= 8; step += 1)
          current.push(cubic(cursor, controlA, controlB, end, step / 8));
        cursor = end;
      }
    }
    if (current.length > 1) lines.push(current);
  }
  return lines;
}

export function roughFrameLines(
  kind: FrameShape,
  bounds: RoughBounds,
  width: number,
  seed: number,
): RoughPoint[][] {
  const generator = rough.generator();
  const options = {
    seed,
    stroke: "#000",
    strokeWidth: width,
    roughness: 1.15,
    bowing: 0.55,
    maxRandomnessOffset: Math.min(2.4, Math.max(0.8, width * 0.42)),
    preserveVertices: true,
  };
  const drawable =
    kind === "ellipse"
      ? generator.ellipse(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
          bounds.width,
          bounds.height,
          options,
        )
      : generator.rectangle(bounds.x, bounds.y, bounds.width, bounds.height, options);
  return drawableLines(drawable);
}
