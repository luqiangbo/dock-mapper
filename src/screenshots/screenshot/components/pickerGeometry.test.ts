import { describe, expect, it } from "vitest";
import { calculatePickerPosition, CAPTURE_LOUPE_BOUNDS } from "./pickerGeometry";

describe("picker preview geometry", () => {
  it("带坐标和快捷键的放大镜仍完整停留在屏幕内", () => {
    expect(calculatePickerPosition(990, 790, 1000, 800, CAPTURE_LOUPE_BOUNDS)).toEqual({
      left: 754,
      top: 680,
    });
  });
  it("clamps the panel at viewport edges", () => {
    expect(calculatePickerPosition(990, 790, 1000, 800)).toEqual({ left: 856, top: 632 });
    expect(calculatePickerPosition(0, 0, 1000, 800)).toEqual({ left: 12, top: 12 });
    expect(calculatePickerPosition(20, 20, 120, 160)).toEqual({ left: 4, top: 4 });
  });
});
