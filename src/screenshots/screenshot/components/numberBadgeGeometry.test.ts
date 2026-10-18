import { describe, expect, it } from "vitest";
import { numberBadgeGeometry } from "./numberBadgeGeometry";
describe("清晰的圆形序号徽标", () => {
  it.each([1, 0.8, 2 / 3, 0.5])("缩放 %s 下保持屏幕直径 36 px，文字按同一比例绘制", (zoom) => {
    const result = numberBadgeGeometry(
      { x: 300, y: 300 },
      36,
      zoom,
      { width: 12 / zoom, ascent: 15 / zoom, descent: 0 },
      { width: 1000, height: 1000 },
    );
    expect(result.diameter * zoom).toBeCloseTo(36);
    expect(result.fontSize * zoom).toBeCloseTo(20.16);
    expect(result.textX + 6 / zoom).toBeCloseTo(result.x + result.diameter / 2);
    expect(result.textY + result.fontSize - 7.5 / zoom).toBeCloseTo(result.y + result.diameter / 2);
  });
  it("三位及更长数字扩展圆形直径并保留文字内边距", () => {
    const result = numberBadgeGeometry(
      { x: 100, y: 100 },
      36,
      1,
      { width: 42, ascent: 15, descent: 0 },
      { width: 500, height: 500 },
    );
    expect(result.diameter).toBe(56);
    expect(result.textX - result.x).toBe(7);
  });
  it("靠近边缘放置时，圆形和白边完整留在截图范围内", () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 100, y: 80 },
    ]) {
      const badge = numberBadgeGeometry(
        point,
        36,
        1,
        { width: 12, ascent: 15, descent: 0 },
        { width: 100, height: 80 },
      );
      expect(badge.x - badge.border / 2).toBeGreaterThanOrEqual(0);
      expect(badge.y - badge.border / 2).toBeGreaterThanOrEqual(0);
      expect(badge.x + badge.diameter + badge.border / 2).toBeLessThanOrEqual(100);
      expect(badge.y + badge.diameter + badge.border / 2).toBeLessThanOrEqual(80);
    }
  });
});
