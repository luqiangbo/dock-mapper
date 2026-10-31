import { describe, expect, it } from "vitest";
import { isNumberPlacementClick, numberPlacementPoint } from "./numberPlacement";
import { numberBadgeGeometry } from "./numberBadgeGeometry";
describe("序号按点击位置放置", () => {
  it("浏览器 DOMRect 的继承属性仍能转换为选区内点击坐标", () => {
    const bounds = Object.create({ left: 140, top: 120, width: 800, height: 420 });
    expect(Object.keys(bounds)).toEqual([]);
    const placement = numberPlacementPoint(
      { x: 400, y: 300 },
      { width: 1200, height: 630 },
      bounds,
      { x: 210, y: 180 },
    );
    expect(placement.inside).toBe(true);
    expect(placement.point).toEqual({ x: 390, y: 270 });
    expect(placement.world).toEqual({ x: 600, y: 450 });
  });
  it.each([1, 1.5, 2])("%s 倍 DPI 下在非零选区原点居中", (dpi) => {
    const result = numberPlacementPoint(
      { x: 350, y: 220 },
      { width: 600 * dpi, height: 400 * dpi },
      { left: 200, top: 120, width: 600, height: 400 },
      { x: 480, y: 360 },
    );
    expect(result.point.x).toBeCloseTo(150 * dpi);
    expect(result.point.y).toBeCloseTo(100 * dpi);
    expect(result.world.x).toBeCloseTo(480 + 150 * dpi);
    expect(result.world.y).toBeCloseTo(360 + 100 * dpi);
    expect(result.left).toBeCloseTo(150);
    expect(result.top).toBeCloseTo(100);
    const badge = numberBadgeGeometry(
      result.world,
      36,
      result.zoom,
      { width: 12, ascent: 15, descent: 0 },
      { width: 600, height: 400 },
    );
    expect(badge.x + badge.diameter / 2).toBe(result.world.x);
    expect(badge.y + badge.diameter / 2).toBe(result.world.y);
    expect(badge.diameter * result.zoom).toBeCloseTo(36);
  });
  it("移动选区后使用新原点，留白处不放置", () => {
    const bounds = { left: 0, top: 0, width: 400, height: 300 };
    const bitmap = { width: 400, height: 200 };
    expect(
      numberPlacementPoint({ x: 100, y: 100 }, bitmap, bounds, { x: 800, y: 400 }).world,
    ).toEqual({ x: 900, y: 450 });
    expect(numberPlacementPoint({ x: 100, y: 20 }, bitmap, bounds, { x: 800, y: 400 }).inside).toBe(
      false,
    );
  });
  it("轻微抖动仍单击，超过阈值的拖动不放置", () => {
    expect(isNumberPlacementClick({ x: 10, y: 10 }, { x: 13, y: 10 })).toBe(true);
    expect(isNumberPlacementClick({ x: 10, y: 10 }, { x: 13, y: 11 })).toBe(false);
  });
});
