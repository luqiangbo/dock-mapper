import { arrowSeed } from "./crayonBrush";
import { brush, paintP5Mask } from "./p5BrushService";

interface ScenePoint {
  x: number;
  y: number;
}

type StrokeTool = "pen" | "highlight";

interface CachedStroke {
  key: string;
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
}

const cache = new Map<string, CachedStroke>();
const CACHE_LIMIT = 64;

export function clearP5StrokeCache(): void {
  cache.clear();
}

function strokeKey(
  points: ScenePoint[],
  tool: StrokeTool,
  color: string,
  width: number,
  opacity: number,
): string {
  return JSON.stringify([
    tool,
    color,
    width,
    opacity,
    points.map(({ x, y }) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]),
  ]);
}

function fallbackStroke(
  context: CanvasRenderingContext2D,
  points: ScenePoint[],
  width: number,
): void {
  context.save();
  context.strokeStyle = "#000";
  context.lineWidth = width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  points.forEach((point, index) =>
    index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y),
  );
  if (points.length === 1) context.lineTo(points[0].x + 0.01, points[0].y + 0.01);
  context.stroke();
  context.restore();
}

export function drawP5Stroke(
  context: CanvasRenderingContext2D,
  id: string,
  tool: StrokeTool,
  points: ScenePoint[],
  color: string,
  width: number,
  opacity: number,
): void {
  if (!points.length) return;
  const key = strokeKey(points, tool, color, width, opacity);
  let item = cache.get(id);
  if (item?.key !== key) {
    const xs = points.map(({ x }) => x);
    const ys = points.map(({ y }) => y);
    const padding = Math.max(4, width * (tool === "highlight" ? 1.1 : 1.7));
    const x = Math.floor(Math.min(...xs) - padding);
    const y = Math.floor(Math.min(...ys) - padding);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(Math.max(...xs) - x + padding));
    canvas.height = Math.max(1, Math.ceil(Math.max(...ys) - y + padding));
    const mask = canvas.getContext("2d", { willReadFrequently: true });
    if (!mask) throw new Error("画笔渲染失败：无法创建离屏画布");
    mask.translate(-x, -y);
    const renderPoints =
      points.length === 1
        ? [points[0], { x: points[0].x + 0.01, y: points[0].y + 0.01 }]
        : points;
    const rendered = paintP5Mask(mask, arrowSeed(`${id}:${tool}`), () => {
      const name = tool === "highlight" ? "dock-highlighter" : "pen";
      const baseWeight = tool === "highlight" ? 2.4 : 0.3;
      brush.set(name, "#000000", width / baseWeight);
      brush.noFill();
      brush.noHatch();
      brush.noWash();
      brush.spline(renderPoints.map(({ x: px, y: py }) => [px, py, 1]), 0.42);
    });
    if (!rendered) {
      mask.clearRect(x, y, canvas.width, canvas.height);
      fallbackStroke(mask, renderPoints, width);
    }
    mask.save();
    mask.globalCompositeOperation = "source-in";
    mask.fillStyle = color;
    mask.fillRect(x, y, canvas.width, canvas.height);
    mask.restore();
    item = { key, canvas, x, y };
    cache.delete(id);
    cache.set(id, item);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  }
  context.save();
  context.globalAlpha *= opacity;
  context.drawImage(item.canvas, item.x, item.y);
  context.restore();
}
