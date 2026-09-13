import { getStroke } from "perfect-freehand";
import type { AnnotationOutlineConfig } from "../../../types";
import type { LineStyle } from "./annotationTypes";

export interface FreehandPoint {
  x: number;
  y: number;
  pressure?: number;
}

export type FreehandTool = "pen" | "highlight";

function outlinePath(
  context: CanvasRenderingContext2D,
  outline: number[][],
): void {
  if (!outline.length) return;
  context.beginPath();
  context.moveTo(outline[0][0], outline[0][1]);
  for (let index = 1; index < outline.length - 1; index += 1) {
    const current = outline[index];
    const next = outline[index + 1];
    context.quadraticCurveTo(
      current[0],
      current[1],
      (current[0] + next[0]) / 2,
      (current[1] + next[1]) / 2,
    );
  }
  const last = outline[outline.length - 1];
  context.lineTo(last[0], last[1]);
  context.closePath();
}

export function freehandOutline(
  points: FreehandPoint[],
  tool: FreehandTool,
  width: number,
  pressureEnabled = true,
): number[][] {
  const hasRealPressure = points.some(
    ({ pressure }) => pressure !== undefined && pressure > 0 && Math.abs(pressure - 0.5) > 0.02,
  );
  return getStroke(
    points.map(({ x, y, pressure }) => [x, y, pressure ?? 0.5]),
    tool === "highlight"
      ? {
          size: width,
          thinning: 0,
          smoothing: 0.8,
          streamline: 0.65,
          simulatePressure: false,
          start: { cap: true },
          end: { cap: true },
          last: true,
        }
      : {
          size: width,
          thinning: pressureEnabled ? 0.55 : 0,
          smoothing: 0.65,
          streamline: 0.5,
          simulatePressure: pressureEnabled && !hasRealPressure,
          start: { cap: true },
          end: { cap: true },
          last: true,
        },
  );
}

/** One filled outline avoids the dark joins produced by segment-by-segment highlighters. */
export function drawFreehandStroke(
  context: CanvasRenderingContext2D,
  tool: FreehandTool,
  points: FreehandPoint[],
  color: string,
  width: number,
  opacity: number,
  outlineStyle?: AnnotationOutlineConfig,
  _lineStyle: LineStyle = "solid",
  _seedValue: string | number = 1,
  pressureEnabled = true,
): void {
  if (!points.length) return;
  const strokeOutline = freehandOutline(points, tool, Math.max(1, width), pressureEnabled);
  if (!strokeOutline.length) return;
  context.save();
  outlinePath(context, strokeOutline);
  if (outlineStyle?.enabled && outlineStyle.width > 0) {
    context.fillStyle = outlineStyle.color;
    context.strokeStyle = outlineStyle.color;
    context.lineWidth = outlineStyle.width * 2;
    context.lineJoin = "round";
    context.stroke();
    context.fill();
  }
  context.globalAlpha *= Math.max(0, Math.min(1, opacity));
  context.fillStyle = color;
  context.fill();
  context.restore();
}
