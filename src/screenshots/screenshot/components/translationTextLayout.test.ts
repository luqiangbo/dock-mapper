import { describe, expect, it } from "vitest";
import {
  fitTranslationText,
  layoutTranslationText,
  wrapTranslationText,
} from "./translationTextLayout";

const measure = (text: string, size: number) => Array.from(text).length * size;
const rect = { x: 10, y: 20, width: 240, height: 24 };

describe("贴近原文的译文排版", () => {
  it("短译文贴近原文字号且不因留白放大，保留标题正文层次", () => {
    const body = layoutTranslationText("Original text", "译文", rect, measure);
    const title = layoutTranslationText("Title", "标题", { ...rect, height: 48 }, measure);
    const source = fitTranslationText("Original text", rect.width, rect.height, measure);
    expect(body.fontSize).toBeLessThanOrEqual(source.fontSize);
    expect(body.fontSize).toBeGreaterThanOrEqual(source.fontSize * 0.95);
    expect(title.fontSize).toBeGreaterThan(body.fontSize);
    expect(body.lineHeight).toBeCloseTo(body.fontSize * 1.25);
    expect(body.y + body.height / 2).toBeCloseTo(rect.y + rect.height / 2);
  });
  it("提供墨迹框时按原字左边界与视觉垂直中心对齐，居中原文保持居中", () => {
    const leftAligned = layoutTranslationText(
      "Settings",
      "设置",
      { x: 10, y: 20, width: 140, height: 24 },
      measure,
      undefined,
      { inkRect: { x: 14, y: 24, width: 60, height: 14 }, fontWeight: 600 },
    );
    expect(leftAligned.x).toBe(14);
    expect(leftAligned.fontWeight).toBe(600);
    expect(leftAligned.fontSize).toBeCloseTo(14 / 0.92, 1);
    const glyphCenter =
      leftAligned.y + leftAligned.baseline - (leftAligned.fontSize * 0.8 - leftAligned.fontSize * 0.2) / 2;
    expect(glyphCenter).toBeCloseTo(24 + 14 / 2, 1);

    const centered = layoutTranslationText(
      "OK",
      "确定",
      { x: 0, y: 0, width: 120, height: 32 },
      measure,
      undefined,
      { inkRect: { x: 45, y: 8, width: 30, height: 16 }, fontWeight: 400 },
    );
    const lineWidth = measure(centered.lines[0], centered.fontSize);
    expect(centered.x + lineWidth / 2).toBeCloseTo(60, 1);
  });
  it("多行靠上、长译文完整容纳，显式空行保留", () => {
    const text = "第一行\n\n第二行较长的文字";
    const layout = layoutTranslationText(
      "Source",
      text,
      { ...rect, width: 80, height: 60 },
      measure,
    );
    expect(layout.lines).toContain("");
    expect(layout.lines.join("")).toBe(text.replace(/\n/g, ""));
    expect(layout.y).toBeLessThan(rect.y + 5);
    expect(layout.x + layout.width).toBeLessThanOrEqual(rect.x + 80);
    expect(layout.y + layout.height).toBeLessThanOrEqual(rect.y + 60);
    expect(layout.lines.every((line) => measure(line, layout.fontSize) <= layout.width)).toBe(true);
  });
  it("英文优先保留单词，仅拆超长词，不丢失空格", () => {
    expect(wrapTranslationText("hello world", 6, 1, measure)).toEqual(["hello ", "world"]);
    expect(wrapTranslationText("hello world", 5, 1, measure)).toEqual(["hello ", "world"]);
    expect(wrapTranslationText("abcdefgh", 3, 1, measure)).toEqual(["abc", "def", "gh"]);
  });
  it("中文括号不落行尾，结束标点不落行首", () => {
    const lines = wrapTranslationText("甲乙（中文），丙丁。", 4, 1, measure);
    expect(lines.join("")).toBe("甲乙（中文），丙丁。");
    expect(lines.every((line) => !/^[，。）、]/u.test(line) && !/[（「]$/u.test(line))).toBe(true);
  });
  it("不拆开组合字符、旗帜和 ZWJ 表情", () => {
    const text = "e\u0301👨‍👩‍👧‍👦🇨🇳";
    const lines = wrapTranslationText(
      text,
      1,
      1,
      (value) => (value.match(/e\u0301|👨‍👩‍👧‍👦|🇨🇳/gu) ?? []).length,
    );
    expect(lines).toEqual(["e\u0301", "👨‍👩‍👧‍👦", "🇨🇳"]);
  });
  it("高 DPI 下坐标、字号和内边距同比缩放", () => {
    const normal = layoutTranslationText("Original", "中文译文", rect, measure);
    const scaled = layoutTranslationText(
      "Original",
      "中文译文",
      { x: 20, y: 40, width: 480, height: 48 },
      measure,
    );
    expect(scaled.lines).toEqual(normal.lines);
    for (const key of [
      "x",
      "y",
      "width",
      "height",
      "fontSize",
      "lineHeight",
      "baseline",
      "selectionOffsetY",
    ] as const)
      expect(scaled[key]).toBeCloseTo(normal[key] * 2);
  });
  it("基线限制在行框内，选字层使用同一基线偏移", () => {
    const layout = layoutTranslationText("Source", "译文", rect, measure, (_text, size) => ({
      ascent: size * 0.8,
      descent: size * 0.2,
      fontAscent: size,
      fontDescent: size * 0.4,
    }));
    expect(layout.baseline).toBeGreaterThanOrEqual(layout.fontSize * 0.8);
    expect(layout.baseline + layout.fontSize * 0.2).toBeLessThanOrEqual(layout.lineHeight);
    const naturalBaseline = (layout.lineHeight - layout.fontSize * 1.4) / 2 + layout.fontSize;
    expect(naturalBaseline + layout.selectionOffsetY).toBeCloseTo(layout.baseline);
  });
});
