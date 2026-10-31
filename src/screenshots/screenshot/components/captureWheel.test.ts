import { describe, expect, it } from "vitest";
import { captureWheelPatch, captureWheelTool } from "./captureWheel";
import {
  DEFAULT_TEXT_STYLE,
  DEFAULT_NUMBER_STYLE,
  normalizeExcalidrawStrokeWidth,
  type ToolSettings,
} from "./annotationTypes";
const settings: ToolSettings = {
  strokeColor: "#e03131",
  outline: { enabled: true, color: "#ffffff", width: 1 },
  strokeWidth: 6,
  shapeKind: "rect",
  lineStyle: "solid",
  fillStyle: "none",
  fillColor: "#e03131",
  roughness: 0,
  roundness: "sharp",
  opacity: 100,
  arrowStyle: "sharp",
  startArrowhead: "none",
  endArrowhead: "arrow",
  penWidth: 6,
  penPressure: true,
  highlightWidth: 24,
  highlightOpacity: 0.32,
  mosaicBlock: 12,
  mosaicEffect: "pixelate",
  blurRadius: 12,
  pickerFormat: "hex",
  textStyle: DEFAULT_TEXT_STYLE,
  numberStyle: DEFAULT_NUMBER_STYLE,
};
describe("画布滚轮大小调整", () => {
  it("选择已有画笔对象后滚轮修改该对象的笔宽", () => {
    const tool = captureWheelTool("select", "pen");
    expect(captureWheelPatch(tool, settings, -120)).toEqual({ penWidth: 7 });
    expect(captureWheelTool("select", null)).toBeNull();
  });
  it("箭头滚轮从 6 到 7，保存读取时不再跳回 6", () => {
    const patch = captureWheelPatch("arrow", settings, -120)!;
    expect(patch.strokeWidth).toBe(7);
    expect(normalizeExcalidrawStrokeWidth(patch.strokeWidth!)).toBe(7);
  });
  it("同一渲染帧的连续滚轮基于最新草稿累积", () => {
    const first = captureWheelPatch("pen", settings, -120)!;
    const second = captureWheelPatch("pen", { ...settings, ...first }, -120)!;
    expect(second.penWidth).toBe(8);
  });
  it("模糊工具调整模糊强度，像素块工具调整颗粒", () => {
    expect(captureWheelPatch("mosaic", { ...settings, mosaicEffect: "blur" }, -120)).toEqual({
      blurRadius: 14,
    });
    expect(captureWheelPatch("mosaic", settings, -120)).toEqual({ mosaicBlock: 14 });
  });
  it("文字和序号调整实际尺寸", () => {
    expect(captureWheelPatch("text", settings, -120)?.textStyle?.fontSize).toBe(26);
    expect(captureWheelPatch("number", settings, -120)?.numberStyle?.size).toBe(38);
  });
  it("大小上限与持久化范围一致", () => {
    expect(captureWheelPatch("pen", { ...settings, penWidth: 32 }, -120)).toEqual({ penWidth: 32 });
    expect(
      captureWheelPatch(
        "number",
        { ...settings, numberStyle: { ...settings.numberStyle, size: 64 } },
        -120,
      )?.numberStyle?.size,
    ).toBe(64);
    expect(captureWheelPatch("highlight", { ...settings, highlightWidth: 32 }, -120)).toEqual({
      highlightWidth: 32,
    });
  });
  it("反向滚轮缩小，Ctrl 滚轮只改变透明度", () => {
    expect(captureWheelPatch("arrow", settings, 120)).toEqual({ strokeWidth: 5 });
    expect(captureWheelPatch("pen", settings, 120, true)).toEqual({ opacity: 95 });
    expect(captureWheelPatch("highlight", settings, -120, true)).toEqual({
      highlightOpacity: 0.37,
    });
  });
});
