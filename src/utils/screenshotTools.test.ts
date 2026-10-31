import { describe, expect, it } from "vitest";
import {
  SCREENSHOT_TOOL_LABELS,
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
    expect(normalizeScreenshotTools()).toHaveLength(defaultScreenshotTools().length);
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
    expect(next).toHaveLength(defaultScreenshotTools().length);
    expect(next[0]).toEqual({ id: "pen", visible: false });
  });
  it("全部隐藏时更多仍包含所有编辑工具，恢复默认重新显示六项", () => {
    const hidden = defaultScreenshotTools().map((tool) => ({ ...tool, visible: false }));
    expect(screenshotToolbarGroups(hidden).main).toHaveLength(0);
    expect(screenshotToolbarGroups(hidden).more).toHaveLength(defaultScreenshotTools().length);
    expect(screenshotToolbarGroups(defaultScreenshotTools()).main).toHaveLength(6);
  });
});

it("旧配置中的已移除工具不会占位或打乱保留工具顺序", () => {
  const result = normalizeScreenshotTools([
    { id: "pen", visible: false },
    { id: "spotlight", visible: true },
    { id: "magnifier", visible: true },
    { id: "text", visible: true },
  ] as unknown as Parameters<typeof normalizeScreenshotTools>[0]);
  expect(result.slice(0, 2)).toEqual([
    { id: "pen", visible: false },
    { id: "text", visible: true },
  ]);
  expect(result.some((tool) => ["spotlight", "magnifier"].includes(tool.id))).toBe(false);
});

it("线段不再出现在默认工具或旧工具配置中，标签不显示快捷键", () => {
  const result = normalizeScreenshotTools([
    { id: "line", visible: true },
    { id: "arrow", visible: true },
  ] as unknown as Parameters<typeof normalizeScreenshotTools>[0]);
  expect(result.some((tool) => String(tool.id) === "line")).toBe(false);
  expect(result[0]).toEqual({ id: "arrow", visible: true });
  expect(
    Object.values(SCREENSHOT_TOOL_LABELS).some((label) => /Shift|Ctrl|Esc|Enter/.test(label)),
  ).toBe(false);
});
