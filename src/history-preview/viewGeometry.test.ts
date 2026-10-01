import { describe, expect, it } from "vitest";
import { fitView, zoomAt, constrainView, escapeAction } from "./viewGeometry";
const stage = { width: 800, height: 600 };
const image = { width: 2000, height: 1400 };
describe("原图查看", () => {
  it("滚轮放大后指针指向同一个原图位置", () => {
    const view = { scale: 1, x: 0, y: 0, mode: "manual" as const };
    const point = { x: 100, y: 50 };
    const next = zoomAt(view, stage, image, 2, point);
    expect((point.x - next.x) / next.scale).toBe((point.x - view.x) / view.scale);
    expect((point.y - next.y) / next.scale).toBe((point.y - view.y) / view.scale);
  });
  it("拖动不能让图片完全移出视野，小图也可拖动", () => {
    const view = constrainView({ scale: 1, x: 9000, y: -9000, mode: "manual" }, stage, image);
    expect(view.x).toBeLessThan((stage.width + image.width) / 2);
    expect(view.y).toBeGreaterThan(-(stage.height + image.height) / 2);
    const small = constrainView(view, stage, { width: 100, height: 100 });
    expect(small.x).toBeLessThan(450);
    expect(small.y).toBeGreaterThan(-350);
    expect(small.x).toBeGreaterThan(0);
  });
  it("小图放大时也保留指针对应的原图位置", () => {
    const next = zoomAt(
      { scale: 1, x: 0, y: 0, mode: "fit" },
      stage,
      { width: 100, height: 100 },
      1.2,
      { x: 30, y: 20 },
    );
    expect((30 - next.x) / next.scale).toBeCloseTo(30);
    expect((20 - next.y) / next.scale).toBeCloseTo(20);
  });
  it("极大图片可以适应窗口到百分之十以下，缩放不超过八倍", () => {
    const huge = { width: 50000, height: 50000 };
    const fit = fitView(stage, huge);
    expect(fit.scale).toBeLessThan(0.1);
    expect(zoomAt(fit, stage, huge, 0, { x: 0, y: 0 }).scale).toBe(fit.scale);
    expect(zoomAt(fit, stage, huge, 20, { x: 0, y: 0 }).scale).toBe(8);
  });
  it("Escape 先退出全屏，再关闭窗口", () => {
    expect(escapeAction(true)).toBe("exit-fullscreen");
    expect(escapeAction(false)).toBe("close");
  });
});
