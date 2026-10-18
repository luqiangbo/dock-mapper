import { describe, expect, it } from "vitest";
import {
  SYSTEM_FONTS,
  DEFAULT_FONT_FAVORITES,
  normalizeFontFavorites,
  systemFontOptions,
} from "./systemFonts";
import { fontFamily } from "./textTypes";
import { DEFAULT_ANNOTATION_STYLES } from "./annotationStyleDefaults";
import { excalidrawFillPatch } from "./excalidrawScreenshotAdapter";

describe("截图样式的可见默认值", () => {
  it("线段与箭头默认使用红色和明显手绘，形状默认无填充", () => {
    for (const tool of ["shape", "line", "arrow"] as const) {
      expect(DEFAULT_ANNOTATION_STYLES[tool]).toMatchObject({
        stroke_color: "#e03131",
        roughness: 2,
        fill_style: "none",
      });
    }
  });
  it("选择无填充会清除已有背景，重新启用填充会恢复选定颜色", () => {
    expect(excalidrawFillPatch({ fillStyle: "none" }, "#ffc9c9", "#ffffff")).toEqual({
      backgroundColor: "transparent",
      fillStyle: "solid",
    });
    expect(excalidrawFillPatch({ fillStyle: "solid" }, "transparent", "#ffc9c9")).toEqual({
      backgroundColor: "#ffc9c9",
      fillStyle: "solid",
    });
    expect(
      excalidrawFillPatch({ fillColor: "#e03131", fillStyle: "hachure" }, "transparent", "#ffffff"),
    ).toEqual({ backgroundColor: "#e03131", fillStyle: "hachure" });
  });
  it("常用字体保留顺序、去重、剔除未知字体且最多十项", () => {
    expect(normalizeFontFavorites(["arial", "arial", "unknown", "simsun"])).toEqual([
      "arial",
      "simsun",
    ]);
    expect(normalizeFontFavorites(SYSTEM_FONTS.map((font) => font.key))).toHaveLength(10);
    expect(normalizeFontFavorites([])).toEqual(DEFAULT_FONT_FAVORITES);
    expect(systemFontOptions(["simsun", "arial"])).toEqual([
      { value: "simsun", label: "宋体" },
      { value: "arial", label: "Arial" },
    ]);
  });
  it("中文和英文字体使用真实系统字体名并保留中文回退", () => {
    expect(fontFamily("microsoft-yahei")).toContain("Microsoft YaHei");
    expect(fontFamily("times-new-roman")).toContain("Times New Roman");
    expect(fontFamily("consolas")).toContain("Consolas");
  });
});
