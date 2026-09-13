import { drawRasterAnnotation } from "./annotationRenderer";
import { fontFamily } from "./textTypes";
import { wrapTextLines } from "./textLayout";
import type { SceneElement } from "./whiteboardScene";

function drawText(context: CanvasRenderingContext2D, element: Extract<SceneElement, { type: "text" }>): void {
  const obj = element.value;
  const fontPx = Math.round(obj.fontSize * obj.scale * obj.transformScale);
  const width = Math.max(1, obj.width * obj.transformScale);
  const lineHeight = Math.round(fontPx * 1.25);
  const padding = 4 * obj.transformScale;
  context.save();
  const centerX = obj.canvasX + width / 2;
  const centerY = obj.canvasY + obj.height * obj.transformScale / 2;
  if (obj.angle) {
    context.translate(centerX, centerY);
    context.rotate(obj.angle);
    context.translate(-centerX, -centerY);
  }
  context.fillStyle = obj.color;
  context.font = `${obj.bold ? "700" : "400"} ${fontPx}px ${fontFamily(obj.font)}`;
  context.textBaseline = "top";
  context.lineWidth = Math.max(0, obj.strokeWidth * obj.scale * obj.transformScale);
  context.strokeStyle = obj.strokeColor;
  wrapTextLines(obj.text, width - padding * 2, (value) => context.measureText(value).width)
    .forEach((value, index) => {
      const y = obj.canvasY + padding + index * lineHeight;
      if (context.lineWidth) context.strokeText(value, obj.canvasX + padding, y);
      context.fillText(value, obj.canvasX + padding, y);
    });
  context.restore();
}

function drawNumber(
  context: CanvasRenderingContext2D,
  element: Extract<SceneElement, { type: "number" }>,
  exportScale: number,
): void {
  const number = element.value;
  const radius = Math.max(12, Math.round((number.style.size * exportScale) / 2));
  context.save();
  if (number.angle) {
    context.translate(number.canvasX, number.canvasY);
    context.rotate(number.angle);
    context.translate(-number.canvasX, -number.canvasY);
  }
  if (number.style.outline.enabled && number.style.outline.width > 0) {
    context.strokeStyle = number.style.outline.color;
    context.lineWidth = number.style.outline.width * exportScale * 2;
    context.beginPath();
    context.arc(number.canvasX, number.canvasY, radius, 0, Math.PI * 2);
    context.stroke();
  }
  context.fillStyle = number.style.backgroundColor;
  context.beginPath();
  context.arc(number.canvasX, number.canvasY, radius, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = number.style.textColor;
  context.font = `700 ${Math.round(radius * 1.05)}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(number.value), number.canvasX, number.canvasY + 1);
  context.restore();
}

/** One deterministic painter shared by preview, copy, save, pin and history PNG export. */
export function renderWhiteboardScene(
  context: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  elements: SceneElement[],
  scale: number,
  includeBase: boolean,
): void {
  context.save();
  try {
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    if (includeBase) context.drawImage(base, 0, 0);
    elements.forEach((element) => {
      if (element.type === "raster") drawRasterAnnotation(context, element.value, base);
      else if (element.type === "text") drawText(context, element);
      else drawNumber(context, element, scale);
    });
  } finally {
    context.restore();
  }
}
