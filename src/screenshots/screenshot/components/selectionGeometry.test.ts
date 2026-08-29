import { describe, expect, it } from "vitest";
import {
  calculateSelectionCrop,
  mapCropPoint,
  moveRect,
  resizeRect,
} from "./selectionGeometry";

describe("selection geometry", () => {
  it("keeps moved selections inside the viewport", () => {
    expect(moveRect({ x: 10, y: 10, width: 40, height: 30 }, 200, -50, 100, 80)).toEqual({
      x: 60,
      y: 0,
      width: 40,
      height: 30,
    });
  });

  it("keeps resized selections above the minimum size", () => {
    expect(resizeRect({ x: 10, y: 10, width: 40, height: 30 }, "nw", 100, 100, 100, 80)).toEqual({
      x: 42,
      y: 32,
      width: 8,
      height: 8,
    });
  });

  it.each([1, 1.25, 1.5, 1.75])(
    "keeps equal-sized moving selections at a stable output size for %sx DPI",
    (scale) => {
      const first = calculateSelectionCrop(
        { x: 11, y: 17, width: 301, height: 179 },
        1920 * scale,
        1080 * scale,
        1920,
        1080,
      );
      const moved = calculateSelectionCrop(
        { x: 12, y: 18, width: 301, height: 179 },
        1920 * scale,
        1080 * scale,
        1920,
        1080,
      );
      expect([moved.outputWidth, moved.outputHeight]).toEqual([
        first.outputWidth,
        first.outputHeight,
      ]);
      expect(moved.sourceWidth).toBeCloseTo(first.sourceWidth, 8);
      expect(moved.sourceHeight).toBeCloseTo(first.sourceHeight, 8);
    },
  );

  it("maps retained annotation points through source-image coordinates", () => {
    const from = calculateSelectionCrop(
      { x: 100, y: 80, width: 400, height: 300 },
      2400,
      1350,
      1920,
      1080,
    );
    const to = calculateSelectionCrop(
      { x: 120, y: 100, width: 400, height: 300 },
      2400,
      1350,
      1920,
      1080,
    );
    expect(mapCropPoint({ x: 125, y: 100 }, from, to)).toEqual({ x: 100, y: 75 });
  });

  it("keeps an edge crop inside the physical image without changing its rounded size", () => {
    const crop = calculateSelectionCrop(
      { x: 1539.2, y: 859.2, width: 380.8, height: 220.8 },
      2400,
      1350,
      1920,
      1080,
    );
    expect(crop.sourceX + crop.sourceWidth).toBeLessThanOrEqual(2400);
    expect(crop.sourceY + crop.sourceHeight).toBeLessThanOrEqual(1350);
    expect(crop.outputWidth).toBe(Math.round(380.8 * 1.25));
    expect(crop.outputHeight).toBe(Math.round(220.8 * 1.25));
  });
});
