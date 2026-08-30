import { describe, expect, it } from "vitest";
import { calculateSelectionCrop, mapCropPoint } from "./selectionGeometry";
import {
  calculateSelectionSizePanelPosition,
  fitSelectionToAspectRatio,
  getSelectionSize,
  getOutputSizeLimits,
  resizeSelectionToSize,
  resizeSelectionToOutputSize,
  resizeSelectionWithAspectRatio,
} from "./selectionSizeGeometry";

describe("selection size geometry", () => {
  it.each([1.25, 1.5, 2])(
    "uses exported pixels instead of logical pixels at %sx DPI",
    (scale) => {
      const selection = { x: 100, y: 80, width: 260, height: 180 };
      const next = resizeSelectionToOutputSize(
        selection,
        { width: 500, height: 300 },
        1920 * scale,
        1080 * scale,
        1920,
        1080,
      );
      expect(next).not.toBeNull();
      const crop = calculateSelectionCrop(next!, 1920 * scale, 1080 * scale, 1920, 1080);
      expect([crop.outputWidth, crop.outputHeight]).toEqual([500, 300]);
      expect(next).toMatchObject({ x: selection.x, y: selection.y });
    },
  );

  it("keeps the top-left fixed and rejects sizes outside its edge and minimum limits", () => {
    const selection = { x: 1800, y: 100, width: 100, height: 100 };
    const limits = getOutputSizeLimits(selection, 2880, 1620, 1920, 1080);
    expect(limits).toMatchObject({ minWidth: 12, maxWidth: 180, minHeight: 12 });
    expect(
      resizeSelectionToOutputSize(selection, { width: limits.maxWidth + 1 }, 2880, 1620, 1920, 1080),
    ).toBeNull();
    expect(
      resizeSelectionToOutputSize(selection, { width: limits.minWidth - 1 }, 2880, 1620, 1920, 1080),
    ).toBeNull();

    const next = resizeSelectionToOutputSize(
      selection,
      { width: limits.maxWidth },
      2880,
      1620,
      1920,
      1080,
    );
    expect(next).toEqual({ x: 1800, y: 100, width: 120, height: 100 });
  });

  it("uses the same crop coordinate mapping as a drag resize", () => {
    const selection = { x: 100, y: 80, width: 400, height: 300 };
    const resized = resizeSelectionToOutputSize(
      selection,
      { width: 600, height: 450 },
      2400,
      1350,
      1920,
      1080,
    );
    expect(resized).not.toBeNull();
    const before = calculateSelectionCrop(selection, 2400, 1350, 1920, 1080);
    const after = calculateSelectionCrop(resized!, 2400, 1350, 1920, 1080);
    expect(mapCropPoint({ x: 125, y: 100 }, before, after)).toEqual({ x: 125, y: 100 });
  });

  it("places the panel above the selection and falls back below while clamping horizontally", () => {
    expect(
      calculateSelectionSizePanelPosition(
        { x: 1900, y: 80, width: 10, height: 30 },
        { width: 184, height: 40 },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ left: 1728, top: 32 });
    expect(
      calculateSelectionSizePanelPosition(
        { x: 40, y: 20, width: 80, height: 60 },
        { width: 184, height: 40 },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ left: 40, top: 88 });
  });

  it.each([1.25, 1.5, 2])("converts PX and DIP with independent %sx DPI scales", (scale) => {
    const selection = { x: 100, y: 80, width: 240, height: 160 };
    expect(getSelectionSize(selection, 1920 * scale, 1080 * (scale + 0.25), 1920, 1080, "dip"))
      .toEqual({ width: 240, height: 160 });
    expect(getSelectionSize(selection, 1920 * scale, 1080 * (scale + 0.25), 1920, 1080, "px"))
      .toEqual({ width: Math.round(240 * scale), height: Math.round(160 * (scale + 0.25)) });
  });

  it("fits a physical-pixel ratio at fixed top-left under uneven DPI", () => {
    const selection = { x: 100, y: 100, width: 600, height: 400 };
    const fitted = fitSelectionToAspectRatio(selection, { width: 16, height: 9 }, 2880, 2160, 1920, 1080);
    expect(fitted).not.toBeNull();
    const crop = calculateSelectionCrop(fitted!, 2880, 2160, 1920, 1080);
    expect(crop.outputWidth / crop.outputHeight).toBeCloseTo(16 / 9, 2);
    expect(fitted).toMatchObject({ x: 100, y: 100 });
  });

  it("keeps a locked corner resize inside the viewport and above the minimum", () => {
    const resized = resizeSelectionWithAspectRatio(
      { x: 1800, y: 950, width: 80, height: 80 }, "se", 600, 600,
      { width: 1, height: 1 }, 2880, 1620, 1920, 1080,
    );
    expect(resized.x + resized.width).toBeLessThanOrEqual(1920);
    expect(resized.y + resized.height).toBeLessThanOrEqual(1080);
    expect(resized.width).toBeGreaterThanOrEqual(8);
  });

  it("uses DIP input with fixed top-left and rejects a derived size beyond its boundary", () => {
    const selection = { x: 100, y: 100, width: 300, height: 200 };
    expect(resizeSelectionToSize(selection, { width: 320.5 }, "dip", 2880, 1620, 1920, 1080))
      .toMatchObject({ x: 100, y: 100, width: 320.5 });
    expect(resizeSelectionToSize(selection, { width: 1900 }, "dip", 2880, 1620, 1920, 1080)).toBeNull();
  });
});
