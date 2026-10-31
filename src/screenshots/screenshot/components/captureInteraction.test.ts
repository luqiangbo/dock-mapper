import { describe, expect, it } from "vitest";
import { moveCaptureSelection, SelectionDragSession } from "./selectionDrag";
import { fullScreenCandidate, nudgeCaptureSelection, pickerPixel } from "./captureInteraction";

describe("截图选区和像素定位", () => {
  it("没有窗口候选时仍能选择整个屏幕", () => {
    expect(fullScreenCandidate(1280, 720)).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });
  it("150% DPI 下方向键只移动一个物理像素", () => {
    const next = nudgeCaptureSelection(
      { x: 20, y: 20, width: 100, height: 100 },
      "ArrowRight",
      "move",
      1920,
      1080,
      1280,
      720,
    );
    expect(next.x * 1.5).toBe(31);
    expect(next.width).toBe(100);
  });
  it("左边向内收缩保留右边位置", () => {
    expect(
      nudgeCaptureSelection(
        { x: 10, y: 10, width: 100, height: 50 },
        "ArrowLeft",
        "shrink",
        800,
        600,
        800,
        600,
      ),
    ).toEqual({ x: 11, y: 10, width: 99, height: 50 });
  });
  it("边界上的选区不能继续扩展", () => {
    const rect = { x: 0, y: 0, width: 800, height: 600 };
    expect(nudgeCaptureSelection(rect, "ArrowRight", "expand", 800, 600, 800, 600)).toBe(rect);
  });
  it("屏幕右下角取色不会读取图片之外", () => {
    expect(pickerPixel(1280, 720, 1920, 1080, 1280, 720)).toEqual({ x: 1919, y: 1079 });
  });
});

describe("取景框拖动", () => {
  const rect = { x: 100, y: 80, width: 120, height: 60 };
  const move = (origin: typeof rect, dx: number, dy: number) =>
    moveCaptureSelection(origin, dx, dy, 1920, 1080, 1280, 720);
  it("阈值内的单击不提交裁剪", () => {
    const drag = new SelectionDragSession(rect);
    expect(drag.update(2, 1, move)).toBe(false);
    expect(drag.finish()).toBeNull();
  });
  it("连续预览后只提交一次最终区域", () => {
    const drag = new SelectionDragSession(rect);
    drag.update(10, 0, move);
    drag.update(20, 10, move);
    expect(drag.finish()).toEqual({ ...rect, x: 120, y: 90 });
    expect(drag.finish()).toBeNull();
  });
  it("取消拖动不会提交预览，也不会更改原选区", () => {
    const drag = new SelectionDragSession(rect);
    drag.update(30, 10, move);
    expect(drag.finish(true)).toBeNull();
    expect(drag.finish()).toBeNull();
    expect(drag.origin).toEqual(rect);
  });
  it("150% DPI 拖到屏幕外时保持尺寸并贴住物理像素边界", () => {
    const next = move(rect, 9999, -9999);
    expect(next).toEqual({ ...rect, x: 1160, y: 0 });
    expect(next.x * 1.5 + next.width * 1.5).toBe(1920);
  });
});
