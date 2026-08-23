import { describe, expect, it } from "vitest";
import { resizeTextBox } from "./textTransform";

describe("text selection transform", () => {
  const box = {
    canvasX: 100,
    canvasY: 80,
    width: 200,
    height: 80,
    fontSize: 20,
    transformScale: 1,
  };

  it("scales from the opposite corner", () => {
    const resized = resizeTextBox(box, "se", 500, 240, 1000, 800);
    expect(resized.canvasX).toBe(100);
    expect(resized.canvasY).toBe(80);
    expect(resized.transformScale).toBeCloseTo(2);
  });

  it("clamps effective font size and canvas bounds", () => {
    const resized = resizeTextBox(box, "nw", -500, -500, 400, 300);
    expect(resized.transformScale).toBeLessThanOrEqual(2);
    expect(resized.canvasX).toBeGreaterThanOrEqual(0);
    expect(resized.canvasY).toBeGreaterThanOrEqual(0);
  });
});
