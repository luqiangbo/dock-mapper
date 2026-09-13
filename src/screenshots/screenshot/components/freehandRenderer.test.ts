import { describe, expect, it } from "vitest";
import { freehandOutline } from "./freehandRenderer";

describe("freehand annotation outlines", () => {
  it("uses pressure for pen and a constant band for highlighter", () => {
    const points = [
      { x: 0, y: 0, pressure: 0.15 },
      { x: 20, y: 4, pressure: 0.9 },
      { x: 40, y: 0, pressure: 0.25 },
    ];
    const pen = freehandOutline(points, "pen", 8);
    const highlight = freehandOutline(points, "highlight", 20);
    expect(pen.length).toBeGreaterThan(4);
    expect(highlight.length).toBeGreaterThan(4);
    expect(pen).not.toEqual(highlight);
  });
});
