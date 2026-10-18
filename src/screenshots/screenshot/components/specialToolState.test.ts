import { describe, expect, it } from "vitest";
import { nextNumber, numberGroupsToErase } from "./specialToolState";
import { resolveScreenshotTool, excalidrawFillPatch } from "./excalidrawScreenshotAdapter";
import { DEFAULT_ANNOTATION_STYLES } from "./annotationStyleDefaults";
describe("截图特殊工具", () => {
  it("编辑器选择回调不会取消取色、序号和高亮", () => {
    expect(resolveScreenshotTool("selection", "picker")).toBe("picker");
    expect(resolveScreenshotTool("selection", "number")).toBe("number");
    expect(resolveScreenshotTool("freedraw", "highlight")).toBe("highlight");
    expect(resolveScreenshotTool("eraser", "eraser")).toBe("eraser");
  });
  it("序号递增，删除或撤销最高序号后按可见序号继续", () => {
    expect(nextNumber([])).toBe(1);
    expect(
      nextNumber([
        { customData: { dockmapperNumber: 1 } },
        { customData: { dockmapperNumber: 2 }, isDeleted: true },
      ]),
    ).toBe(2);
  });
  it("橡皮擦同步删除组合序号另一部分，不擦除原图或其他标注", () => {
    expect([
      ...numberGroupsToErase([
        {
          id: "circle",
          isDeleted: true,
          groupIds: ["g"],
          customData: { dockmapperTool: "number" },
        },
        { id: "text", groupIds: ["g"], customData: { dockmapperTool: "number" } },
        { id: "background", locked: true, groupIds: ["g"] },
        { id: "other", groupIds: ["other"], customData: { dockmapperTool: "number" } },
      ]),
    ]).toEqual(["text"]);
  });
  it("填充可从透明切到颜色，再恢复透明", () => {
    expect(
      excalidrawFillPatch({ fillStyle: "solid", fillColor: "#e03131" }, "transparent", "#e03131")
        .backgroundColor,
    ).toBe("#e03131");
    expect(excalidrawFillPatch({ fillStyle: "none" }, "#e03131", "#e03131").backgroundColor).toBe(
      "transparent",
    );
  });
  it("形状、箭头和画笔的默认值一致，文字和高亮各自可见", () => {
    for (const key of ["shape", "line", "arrow", "pen"] as const)
      expect(DEFAULT_ANNOTATION_STYLES[key]).toMatchObject({
        stroke_color: "#e03131",
        stroke_width: 6,
        roughness: 2,
        fill_style: "none",
        opacity: 1,
      });
    expect(DEFAULT_ANNOTATION_STYLES.text.font_size).toBe(24);
    expect(DEFAULT_ANNOTATION_STYLES.highlight).toMatchObject({ stroke_width: 24, opacity: 0.32 });
    expect(DEFAULT_ANNOTATION_STYLES.number.marker_size).toBe(36);
  });
});
