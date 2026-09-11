import * as brush from "p5.brush/standalone";

export const P5_BRUSH_FALLBACK_EVENT = "dockmapper:p5-brush-fallback";

let sharedBrushCanvas: HTMLCanvasElement | null = null;
let customBrushesRegistered = false;
let lastReportedFailure = "";

function brushCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = sharedBrushCanvas ?? document.createElement("canvas");
  sharedBrushCanvas = canvas;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return canvas;
}

function registerCustomBrushes(): void {
  if (customBrushesRegistered) return;
  brush.add("dock-marker", {
    type: "marker",
    weight: 2,
    scatter: 0.12,
    opacity: 112,
    spacing: 0.045,
    pressure: [1.04, 0.96],
    markerTip: false,
    noise: 0.16,
  });
  brush.add("dock-highlighter", {
    type: "marker",
    weight: 2.4,
    scatter: 0.035,
    opacity: 180,
    spacing: 0.055,
    pressure: [1, 1],
    markerTip: false,
    noise: 0.05,
  });
  brush.add("dock-watercolor", {
    type: "default",
    weight: 0.62,
    scatter: 1.35,
    sharpness: 0.28,
    grain: 28,
    opacity: 54,
    spacing: 0.13,
    pressure: [0.86, 1.08, 0.78],
    markerTip: false,
    noise: 0.5,
  });
  customBrushesRegistered = true;
}

function reportFallback(error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  const message = `自然笔刷渲染失败，已切换基础画笔：${detail}`;
  console.warn(message);
  if (message === lastReportedFailure || typeof window === "undefined") return;
  lastReportedFailure = message;
  window.dispatchEvent(new CustomEvent(P5_BRUSH_FALLBACK_EVENT, { detail: message }));
}

/**
 * Paints one synchronous p5.brush pass into a regular 2D mask canvas.
 * p5.brush owns a single mutable WebGL renderer, so every caller goes through
 * this service instead of creating competing contexts.
 */
export function paintP5Mask(
  context: CanvasRenderingContext2D,
  seed: number,
  draw: () => void,
): boolean {
  const target = context.canvas;
  if (typeof HTMLCanvasElement === "undefined" || !(target instanceof HTMLCanvasElement)) {
    reportFallback(new Error("当前画布不支持 WebGL2"));
    return false;
  }
  try {
    const glCanvas = brushCanvas(target.width, target.height);
    brush.load(glCanvas);
    registerCustomBrushes();
    // Preserve the library's real coverage. Rendering on opaque white and
    // reconstructing alpha from luminance made low-opacity marker pigments disappear.
    brush.clear();
    brush.seed(seed);
    brush.noiseSeed(seed ^ 0x51f15e);
    const transform = context.getTransform();
    brush.push();
    try {
      brush.translate(-glCanvas.width / 2 + transform.e, -glCanvas.height / 2 + transform.f);
      draw();
    } finally {
      brush.pop();
    }
    brush.render();

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, target.width, target.height);
    context.drawImage(glCanvas, 0, 0);
    context.restore();
    const pixels = context.getImageData(0, 0, target.width, target.height).data;
    let visible = false;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 2) continue;
      visible = true;
      break;
    }
    if (!visible) throw new Error("笔刷未产生可见像素");
    lastReportedFailure = "";
    return true;
  } catch (error) {
    reportFallback(error);
    return false;
  }
}

export { brush };
