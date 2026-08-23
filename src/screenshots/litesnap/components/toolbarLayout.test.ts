import { describe, expect, it } from "vitest";
import { calculateToolbarLayout, shouldCompactToolbar } from "./toolbarLayout";

const viewport = { width: 1_000, height: 800 };

describe("floating toolbar layout", () => {
  it("centers primary and secondary bars independently on the selection", () => {
    const layout = calculateToolbarLayout(
      { x: 200, y: 100, width: 400, height: 300 },
      viewport,
      { width: 500, height: 40 },
      { width: 300, height: 34 },
    );
    expect(layout.primary.left).toBe(150);
    expect(layout.secondary?.left).toBe(250);
    expect(layout.placement).toBe("below");
  });

  it("clamps both bars to the viewport edges", () => {
    const left = calculateToolbarLayout(
      { x: 0, y: 100, width: 80, height: 100 },
      viewport,
      { width: 400, height: 40 },
      { width: 300, height: 34 },
    );
    expect(left.primary.left).toBe(8);
    expect(left.secondary?.left).toBe(8);

    const right = calculateToolbarLayout({ x: 920, y: 100, width: 80, height: 100 }, viewport, {
      width: 400,
      height: 40,
    });
    expect(right.primary.left).toBe(592);
  });

  it("moves both bars above when the space below is insufficient", () => {
    const layout = calculateToolbarLayout(
      { x: 200, y: 600, width: 400, height: 170 },
      viewport,
      { width: 500, height: 40 },
      { width: 300, height: 34 },
    );
    expect(layout.placement).toBe("above");
    expect(layout.primary.top).toBe(508);
    expect(layout.secondary?.top).toBe(554);
  });

  it("uses compact mode for small or overflowing viewports", () => {
    expect(shouldCompactToolbar(679, 500)).toBe(true);
    expect(shouldCompactToolbar(800, 790)).toBe(true);
    expect(shouldCompactToolbar(800, 700)).toBe(false);
  });
});
