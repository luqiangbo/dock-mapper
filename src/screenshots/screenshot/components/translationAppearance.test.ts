import { describe, expect, it, vi } from "vitest";
import {
  fitTranslationText,
  sampleTranslationBackground,
  translationExportBackground,
  buildTranslationAppearance,
} from "./translationAppearance";

describe("原位置译文排版", () => {
  const measure = (text: string, size: number) => Array.from(text).length * size;
  it("较长译文自动换行缩小，完整留在原文字区域内", () => {
    const text = "这是用于验证文字覆盖的较长中文译文";
    const layout = fitTranslationText(text, 80, 24, measure);
    expect(layout.lines.join("")).toBe(text);
    expect(layout.lines.every((line) => measure(line, layout.fontSize) <= 80)).toBe(true);
    expect(layout.lines.length * layout.lineHeight).toBeLessThanOrEqual(24);
  });
  it("物理像素同比缩放时布局比例保持一致，不拆开 Unicode 字符", () => {
    const text = "中文🙂日本語한국어";
    const normal = fitTranslationText(text, 100, 20, measure);
    const scaled = fitTranslationText(text, 200, 40, measure);
    expect(normal.lines.join("")).toBe(text);
    expect(scaled.lines).toEqual(normal.lines);
    expect(Math.abs(scaled.fontSize / normal.fontSize - 2)).toBeLessThan(0.01);
  });
  it("按周边背景选择深浅文字，边缘文字不会读取图片之外", () => {
    for (const [value, color] of [
      [245, "#171717"],
      [20, "#ffffff"],
    ] as const) {
      const pixels = new Uint8ClampedArray(10 * 10 * 4).fill(value);
      const sampled = sampleTranslationBackground(
        { width: 10, height: 10, data: pixels },
        { x: 0, y: 0, width: 5, height: 5 },
      );
      expect(sampled.color).toBe(color);
      expect(sampled.background).toBe(`rgb(${value}, ${value}, ${value})`);
    }
  });
  it("导出固定当前显示背景，之后切回原文不改变已取得的快照", () => {
    const original = { id: "original" } as unknown as HTMLCanvasElement;
    const translated = { canvas: { id: "translated" } } as unknown as Parameters<
      typeof translationExportBackground
    >[1];
    const snapshot = translationExportBackground(original, translated, true);
    expect(snapshot).toBe(translated!.canvas);
    expect(translationExportBackground(original, translated, false)).toBe(original);
    expect(snapshot).toBe(translated!.canvas);
  });
  it("预览与导出共用基线和文字布局，遮罩不扩到相邻区域且不改原图", () => {
    const context = {
      font: "",
      textBaseline: "",
      fillStyle: "",
      measureText: (text: string) => {
        const size = Number(context.font.match(/([\d.]+)px/)?.[1] ?? 10);
        return {
          width: Array.from(text).length * size,
          actualBoundingBoxAscent: size * 0.8,
          actualBoundingBoxDescent: size * 0.2,
          fontBoundingBoxAscent: size * 0.8,
          fontBoundingBoxDescent: size * 0.2,
        };
      },
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      save: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      restore: vi.fn(),
    };
    const canvas = { width: 0, height: 0, getContext: () => context };
    const originalContext = {
      getImageData: () => ({
        width: 240,
        height: 80,
        data: new Uint8ClampedArray(240 * 80 * 4).fill(245),
      }),
      fillRect: vi.fn(),
      fillText: vi.fn(),
    };
    const base = {
      width: 240,
      height: 80,
      getContext: () => originalContext,
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal("document", { createElement: () => canvas });
    try {
      const original = {
        text: "Original",
        engine: "onnx" as const,
        blocks: [{ text: "Original", x: 10, y: 10, width: 160, height: 24, confidence: 1 }],
      };
      const appearance = buildTranslationAppearance(base, original, [{ id: 0, text: "译文" }]);
      const layout = appearance.layouts[0];
      expect(context.fillRect).toHaveBeenCalledWith(10, 10, 160, 24);
      expect(context.textBaseline).toBe("alphabetic");
      expect(context.fillText).toHaveBeenCalledWith(
        layout.lines[0],
        layout.x,
        layout.y + layout.baseline,
      );
      expect(appearance.result.blocks[0]).toMatchObject({
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      });
      expect(translationExportBackground(base, appearance, true)).toBe(canvas);
      expect(translationExportBackground(base, appearance, false)).toBe(base);
      expect(originalContext.fillRect).not.toHaveBeenCalled();
      expect(originalContext.fillText).not.toHaveBeenCalled();
      expect(original.blocks[0].text).toBe("Original");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
