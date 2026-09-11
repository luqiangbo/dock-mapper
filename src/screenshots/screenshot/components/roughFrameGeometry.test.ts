import { describe, expect, it } from "vitest";
import { roughFrameLines } from "./roughFrameGeometry";

describe("Rough frame geometry", () => {
  it("is deterministic for one annotation seed", () => {
    const bounds = { x: 12, y: 18, width: 180, height: 90 };
    expect(roughFrameLines("rect", bounds, 4, 72)).toEqual(
      roughFrameLines("rect", bounds, 4, 72),
    );
    expect(roughFrameLines("rect", bounds, 4, 72)).not.toEqual(
      roughFrameLines("rect", bounds, 4, 73),
    );
  });

  it("produces brushable line samples for rectangles and ellipses", () => {
    for (const kind of ["rect", "ellipse"] as const) {
      const lines = roughFrameLines(kind, { x: 8, y: 8, width: 160, height: 80 }, 3, 11);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((line) => line.length > 1)).toBe(true);
      expect(lines.flat().every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    }
  });
});
