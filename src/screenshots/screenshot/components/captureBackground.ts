export const OUTSIDE_DIM_OPACITY = 0.55;
export interface BackgroundCrop {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
}

/** UI-only paint. Never pass this canvas to PNG export or clipboard output. */
export function paintCaptureBackground(
  canvas: HTMLCanvasElement,
  image: CanvasImageSource,
  crop: BackgroundCrop | null,
  showStroke = true,
) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("截图背景画布不可用");
  // Reset clip, transform and compositing; save()/restore() alone cannot remove
  // a clip inherited from a previous drawing operation.
  if (typeof context.reset === "function") context.reset();
  else canvas.width = canvas.width;
  const { width, height } = canvas;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.filter = "none";
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  context.fillStyle = `rgba(0, 0, 0, ${OUTSIDE_DIM_OPACITY})`;
  context.fillRect(0, 0, width, height);
  if (!crop || crop.sourceWidth <= 0 || crop.sourceHeight <= 0) return;
  context.save();
  context.beginPath();
  context.rect(crop.sourceX, crop.sourceY, crop.sourceWidth, crop.sourceHeight);
  context.clip();
  context.drawImage(image, 0, 0, width, height);
  context.restore();
  if (showStroke) {
    for (const [color, lineWidth] of [
      ["rgba(0, 0, 0, 0.9)", 4],
      ["rgba(255, 255, 255, 0.96)", 2],
    ] as const) {
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.strokeRect(
        crop.sourceX + 1,
        crop.sourceY + 1,
        Math.max(0, crop.sourceWidth - 2),
        Math.max(0, crop.sourceHeight - 2),
      );
    }
  }
}
