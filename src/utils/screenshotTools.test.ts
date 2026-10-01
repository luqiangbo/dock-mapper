import { describe, expect, it } from "vitest";
import {
  defaultScreenshotTools,
  moveScreenshotTool,
  normalizeScreenshotTools,
  screenshotToolbarGroups,
} from "./screenshotTools";

describe("常用截图工具", () => {
  it("旧配置默认显示原有六个常用工具", () => {
    expect(screenshotToolbarGroups().main).toEqual([
      "select",
      "rect",
      "arrow",
      "pen",
      "text",
      "mosaic",
    ]);
    expect(normalizeScreenshotTools()).toHaveLength(13);
  });
  it("拖动排序保留显示开关，隐藏工具仍可在更多找到", () => {
    const tools = defaultScreenshotTools().map((tool) =>
      tool.id === "rect"
        ? { ...tool, visible: false }
        : tool.id === "ellipse"
          ? { ...tool, visible: true }
          : tool,
    );
    const next = moveScreenshotTool(tools, "ellipse", 0);
    expect(screenshotToolbarGroups(next).main[0]).toBe("ellipse");
    expect(screenshotToolbarGroups(next).main).not.toContain("rect");
    expect(screenshotToolbarGroups(next).more).toContain("rect");
    expect(tools[0].id).toBe("select");
  });
  it("相同位置不写新顺序，非法与重复工具被剔除，缺少项补齐", () => {
    const tools = defaultScreenshotTools();
    expect(moveScreenshotTool(tools, "select", 0)).toBe(tools);
    expect(moveScreenshotTool(tools, "select", -1)).toBe(tools);
    const next = normalizeScreenshotTools([
      { id: "pen", visible: false },
      { id: "pen", visible: true },
      { id: "unknown", visible: true },
    ] as unknown as typeof tools);
    expect(next).toHaveLength(13);
    expect(next[0]).toEqual({ id: "pen", visible: false });
  });
  it("全部隐藏时更多仍包含所有编辑工具，恢复默认重新显示六项", () => {
    const hidden = defaultScreenshotTools().map((tool) => ({ ...tool, visible: false }));
    expect(screenshotToolbarGroups(hidden).main).toHaveLength(0);
    expect(screenshotToolbarGroups(hidden).more).toHaveLength(13);
    expect(screenshotToolbarGroups(defaultScreenshotTools()).main).toHaveLength(6);
  });
});
