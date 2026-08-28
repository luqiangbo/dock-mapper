import { describe, expect, it } from "vitest";
import { calculatePickerPosition, resolveScreenPoint } from "./pickerGeometry";

describe("picker preview geometry", () => {
  it("clamps the panel at viewport edges", () => {
    expect(calculatePickerPosition(990, 790, 1000, 800)).toEqual({ left: 804, top: 532 });
    expect(calculatePickerPosition(0, 0, 1000, 800)).toEqual({ left: 18, top: 18 });
    expect(calculatePickerPosition(20, 20, 120, 160)).toEqual({ left: 8, top: 8 });
  });

  it("falls back to client coordinates when screen coordinates are unavailable", () => {
    expect(resolveScreenPoint({ clientX: 12.4, clientY: 34.6 })).toEqual({
      screenX: 12,
      screenY: 35,
    });
  });
});
