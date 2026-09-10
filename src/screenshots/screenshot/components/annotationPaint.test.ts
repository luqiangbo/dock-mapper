import { describe, expect, it } from "vitest";
import { createPaintSampler, normalizeGradientStops, paintCacheKey } from "./annotationPaint";

describe("annotation gradient paint", () => {
  it("sorts, clamps and bounds gradient stops for stable annotation storage", () => {
    const normalized = normalizeGradientStops([
      { offset: 1.4, color: "#00FF00" },
      { offset: 0.5, color: "invalid" },
      { offset: -1, color: "#FF0000" },
      { offset: 0.5, color: "#0000FF" },
    ]);
    expect(normalized).toEqual([
      { offset: 0, color: "#ff0000" },
      { offset: 0.5, color: "#0000ff" },
      { offset: 1, color: "#00ff00" },
    ]);
  });

  it("samples a multi-stop gradient and produces a deterministic cache key", () => {
    const stops = [
      { offset: 0, color: "#ff0000" },
      { offset: 0.5, color: "#00ff00" },
      { offset: 1, color: "#0000ff" },
    ];
    const sample = createPaintSampler("#ffffff", stops);
    expect(sample(0)).toBe("#ff0000");
    expect(sample(0.5)).toBe("#00ff00");
    expect(sample(1)).toBe("#0000ff");
    expect(paintCacheKey(stops)).toBe(paintCacheKey([...stops]));
  });

  it("falls back to the legacy solid color when no gradient exists", () => {
    expect(createPaintSampler("#f43f5e")(.5)).toBe("#f43f5e");
  });
});
