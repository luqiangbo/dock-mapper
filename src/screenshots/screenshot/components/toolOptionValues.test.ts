import { describe, expect, it } from "vitest";
import {
  normalizeHexColor,
  selectNumber,
  defaultFirst,
  defaultOptionValue,
} from "./toolOptionValues";

describe("Ant Design tool option adapters", () => {
  it("固定默认项排在第一，箭头两端使用各自默认值", () => {
    const options = [1, 2, 3, 4, 6, 8, 12].map((value) => ({ value }));
    expect(
      defaultFirst(options, defaultOptionValue("arrow-width")).map((option) => option.value),
    ).toEqual([6, 1, 2, 3, 4, 8, 12]);
    expect(defaultOptionValue("frame-roughness")).toBe(2);
    expect(defaultOptionValue("arrow-start")).toBe("none");
    expect(defaultOptionValue("arrow-end")).toBe("arrow");
    expect(defaultOptionValue("highlight-opacity")).toBe(32);
  });
  it("normalizes colors and numeric Select values", () => {
    expect(normalizeHexColor("#AbC")).toBe("#aabbcc");
    expect(normalizeHexColor("#12ABef")).toBe("#12abef");
    expect(selectNumber("32")).toBe(32);
  });
});
