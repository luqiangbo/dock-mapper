import { describe, expect, it } from "vitest";
import { formatSequence } from "./numberSequence";
describe("序号显示", () => {
  it("超过 Z 后继续显示 AA", () => {
    expect(formatSequence(27, "alpha")).toBe("AA");
  });
  it("罗马数字支持减法记法", () => {
    expect(formatSequence(49, "roman")).toBe("XLIX");
  });
  it("超出罗马数字范围时显示完整数字", () => {
    expect(formatSequence(4000, "roman")).toBe("4000");
  });
});
