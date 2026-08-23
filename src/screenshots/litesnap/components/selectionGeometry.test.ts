import { describe, expect, it } from "vitest";
import { moveRect, resizeRect } from "./selectionGeometry";

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
});
