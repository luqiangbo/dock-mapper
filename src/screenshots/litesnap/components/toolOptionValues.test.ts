import { describe, expect, it } from "vitest";
import { normalizeHexColor, selectNumber } from "./toolOptionValues";

describe("Ant Design tool option adapters", () => {
  it("normalizes colors and numeric Select values", () => {
    expect(normalizeHexColor("#AbC")).toBe("#aabbcc");
    expect(normalizeHexColor("#12ABef")).toBe("#12abef");
    expect(selectNumber("32")).toBe(32);
  });
});
