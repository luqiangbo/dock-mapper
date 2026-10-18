import { describe, expect, it } from "vitest";
import { formatPickerColor, type PickerSample } from "./pickerColor";
describe("取色复制格式", () => {
  it("同一采样点只添加一个井号，并按所选格式复制", () => {
    const sample: PickerSample = {
      hex: "E03131",
      red: 224,
      green: 49,
      blue: 49,
      imageX: 0,
      imageY: 0,
      left: 0,
      top: 0,
    };
    expect(formatPickerColor(sample, "hex")).toBe("#E03131");
    expect(formatPickerColor(sample, "rgb")).toBe("rgb(224, 49, 49)");
  });
});
