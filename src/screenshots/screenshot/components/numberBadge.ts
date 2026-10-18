import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  newElementWith,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { NumberStyle } from "./annotationTypes";
import font from "./numberFont.json";
import { numberBadgeGeometry } from "./numberBadgeGeometry";
import { nextNumber } from "./specialToolState";

let fontReady: Promise<void> | null = null;
export function loadNumberFont(): Promise<void> {
  if (!fontReady)
    fontReady = (async () => {
      // Give a real installed bold face its own family. Excalidraw requests normal
      // weight; the aliased face still has genuinely bold outlines in PNG export.
      const face = new FontFace(font.family, 'local("Segoe UI Bold"), local("Arial Bold")');
      document.fonts.add(await face.load());
    })().catch((error) => {
      fontReady = null;
      throw new Error(`序号粗体字体加载失败：${String(error)}`);
    });
  return fontReady;
}
export function addNumberBadge(
  api: ExcalidrawImperativeAPI,
  base: HTMLCanvasElement,
  point: { x: number; y: number },
  style: NumberStyle,
) {
  const value = nextNumber(api.getSceneElements());
  const zoom = api.getAppState().zoom.value;
  const fontSize = (style.size * 0.56) / Math.max(0.01, zoom);
  const context = document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("序号文字测量不可用");
  context.font = `${fontSize}px "${font.family}"`;
  const measure = context.measureText(String(value));
  const geometry = numberBadgeGeometry(
    point,
    style.size,
    zoom,
    {
      width: measure.width,
      ascent: measure.actualBoundingBoxAscent,
      descent: measure.actualBoundingBoxDescent,
    },
    base,
  );
  const common = {
    groupIds: [crypto.randomUUID()],
    customData: { dockmapperTool: "number", dockmapperNumber: value },
    roughness: 0,
    opacity: 100,
  };
  const created = convertToExcalidrawElements([
    {
      ...common,
      type: "ellipse",
      x: geometry.x,
      y: geometry.y,
      width: geometry.diameter,
      height: geometry.diameter,
      strokeColor: style.outline.enabled ? style.outline.color : style.backgroundColor,
      strokeWidth: style.outline.enabled ? geometry.border : 0,
      backgroundColor: style.backgroundColor,
      fillStyle: "solid",
    },
    {
      ...common,
      type: "text",
      x: geometry.textX,
      y: geometry.textY,
      text: String(value),
      fontSize: geometry.fontSize,
      fontFamily: font.id,
      strokeColor: style.textColor,
      textAlign: "left",
      verticalAlign: "top",
    },
  ] as never);
  // Center measured advance width, while preserving the font's optical baseline.
  const text = created[1];
  if (text)
    created[1] = newElementWith(text, {
      x: geometry.x + (geometry.diameter - text.width) / 2,
      y: geometry.textY,
    });
  api.updateScene({
    elements: [...api.getSceneElements(), ...created],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}
