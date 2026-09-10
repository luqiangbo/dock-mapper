import { describe, expect, it } from "vitest";
import { decorativePalette, decorativeVariant } from "./framePalette";
import { FRAME_EFFECT_OPTIONS, ARROW_EFFECT_OPTIONS } from "./annotationTypes";

describe("frame palettes", () => {
  it("keeps frame effects independent from the arrow presets", () => {
    const frames = FRAME_EFFECT_OPTIONS.map(({ value }) => value);
    const arrows = ARROW_EFFECT_OPTIONS.map(({ value }) => value);
    expect(frames).toContain("watercolor");
    expect(arrows).not.toContain("watercolor");
    expect(arrows).toContain("marker");
    expect(frames).not.toContain("marker");
  });

  it("selects nine stable decorative patterns and derives contrasting palettes", () => {
    expect(Array.from({ length: 9 }, (_, index) => decorativeVariant(index))).toEqual([
      "stripes",
      "dots",
      "stitches",
      "color-block",
      "halftone",
      "waves",
      "grid",
      "scales",
      "speckles",
    ]);
    expect(decorativeVariant(37)).toBe(decorativeVariant(37));
    const colorful = decorativePalette("#f43f5e", 37);
    expect(new Set(Object.values(colorful)).size).toBe(5);
    expect(colorful.base).toBe("#f43f5e");
    const neutral = decorativePalette("#ffffff", 37);
    expect(neutral.base).toBe("#2878d0");
    expect(neutral.light).toBe("#ffffff");
  });
});
