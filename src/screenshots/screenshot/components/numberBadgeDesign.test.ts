import { describe, expect, it } from "vitest";
import { DEFAULT_NUMBER_STYLE } from "./annotationTypes";
import { numberBadgeDesign } from "./numberBadgeDesign";
import { numberGroupsToErase } from "./specialToolState";
describe("简洁圆形序号", () => {
  it("连续编号保持用户所选颜色，不自动轮换", () => {
    expect(DEFAULT_NUMBER_STYLE.size).toBe(28);
    expect(numberBadgeDesign(DEFAULT_NUMBER_STYLE, 1)).toEqual(
      numberBadgeDesign(DEFAULT_NUMBER_STYLE, 7),
    );
    expect(numberBadgeDesign(DEFAULT_NUMBER_STYLE, 1)).toEqual({
      appearance: "flat",
      fill: "#e03131",
      text: "#ffffff",
    });
  });
  it("旧外观统一为平面，保留有效自定义颜色", () => {
    expect(
      numberBadgeDesign(
        {
          ...DEFAULT_NUMBER_STYLE,
          appearance: "pixel",
          backgroundColor: "#123456",
          textColor: "#654321",
        },
        1,
      ),
    ).toEqual({ appearance: "flat", fill: "#123456", text: "#654321" });
  });
  it("淘汰旧部件不擦除整组，实际擦除任一部件仍删除整组", () => {
    const retired = {
      id: "old-text",
      isDeleted: true,
      groupIds: ["g"],
      customData: { dockmapperTool: "number", dockmapperRetired: true },
    };
    const body = { id: "body", groupIds: ["g"], customData: { dockmapperTool: "number" } };
    expect(numberGroupsToErase([retired, body]).size).toBe(0);
    expect(
      numberGroupsToErase([{ ...retired, customData: { dockmapperTool: "number" } }, body]).has(
        "body",
      ),
    ).toBe(true);
  });
});
