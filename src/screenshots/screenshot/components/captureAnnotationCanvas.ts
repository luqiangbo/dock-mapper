import { exportToCanvas, getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/** Render screen-anchored annotations into the current crop, clipping outside objects. */
export async function captureAnnotationCanvas(
  api: ExcalidrawImperativeAPI,
  base: HTMLCanvasElement,
  x: number,
  y: number,
) {
  const canvas = document.createElement("canvas");
  canvas.width = base.width;
  canvas.height = base.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("标注合成画布不可用");
  const elements = api.getSceneElements().filter((element) => !element.locked);
  if (!elements.length) return canvas;
  const bounds = getCommonBounds(elements);
  const annotations = await exportToCanvas({
    elements,
    files: api.getFiles(),
    appState: {
      ...api.getAppState(),
      exportBackground: false,
      exportWithDarkMode: false,
      exportScale: 1,
    },
    exportPadding: 0,
  });
  ctx.drawImage(annotations, bounds[0] - x, bounds[1] - y);
  return canvas;
}
