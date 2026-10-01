import { describe, expect, it } from "vitest";
import { screenshotViewport, bitmapToClient, clientToBitmap } from "./screenshotViewport";

describe("截图底图与标注坐标", () => {
  it.each([1, 1.5, 2])("%s 倍显示缩放下不按编辑器步长取整", (scale) => {
    const rect = { left: 127.25, top: 83.75, width: 333.3, height: 199.4 };
    const view = screenshotViewport(
      Math.round(rect.width * scale),
      Math.round(rect.height * scale),
      rect,
    );
    const point = { x: 123.4, y: 78.9 };
    const restored = clientToBitmap(bitmapToClient(point, view), view);
    expect(restored.x).toBeCloseTo(point.x, 10);
    expect(restored.y).toBeCloseTo(point.y, 10);
    expect(view.zoom).toBe(
      Math.min(
        rect.width / Math.round(rect.width * scale),
        rect.height / Math.round(rect.height * scale),
      ),
    );
  });
  it("不同宽高比只产生共同的居中偏移", () => {
    const view = screenshotViewport(100, 80, { left: 30, top: 40, width: 200, height: 200 });
    expect(bitmapToClient({ x: 0, y: 0 }, view)).toEqual({ x: 30, y: 60 });
    expect(bitmapToClient({ x: 100, y: 80 }, view)).toEqual({ x: 230, y: 220 });
  });
});
