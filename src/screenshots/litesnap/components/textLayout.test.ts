import { describe, expect, it } from "vitest";
import { isTextObjectInteractive, wrapTextLines } from "./textLayout";

const measure = (value: string) => Array.from(value).length;

describe("screenshot text wrapping", () => {
  it("preserves explicit and empty lines", () => {
    expect(wrapTextLines("第一行\n\n第三行", 20, measure)).toEqual(["第一行", "", "第三行"]);
  });

  it("wraps Chinese and oversized URLs without spaces", () => {
    expect(wrapTextLines("一二三四五六", 3, measure)).toEqual(["一二三", "四五六"]);
    expect(wrapTextLines("https://example.com", 8, measure)).toEqual([
      "https://",
      "example.",
      "com",
    ]);
  });

  it("prefers word boundaries for ordinary English", () => {
    expect(wrapTextLines("hello world", 7, measure)).toEqual(["hello", "world"]);
  });

  it("only lets text objects receive input while the text tool is active", () => {
    expect(isTextObjectInteractive("text")).toBe(true);
    expect(isTextObjectInteractive("brush")).toBe(false);
    expect(isTextObjectInteractive("picker")).toBe(false);
    expect(isTextObjectInteractive(null)).toBe(false);
  });
});
