import { describe, expect, it } from "vitest";
import {
  captureBackgroundSkeleton,
  captureExportDimensions,
  excalidrawStyleCapabilities,
  excalidrawToolType,
  isExcalidrawStyleTool,
  isSameExcalidrawSelection,
  screenshotEditorPresentation,
  type ExcalidrawSelectionState,
} from "./excalidrawScreenshotAdapter";

describe("Excalidraw screenshot adapter", () => {
  it("creates a locked physical-pixel screenshot background", () => {
    expect(captureBackgroundSkeleton("capture", 1920, 1080)).toMatchObject({
      type: "image",
      fileId: "capture",
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      locked: true,
    });
  });

  it("maps only supported DockMapper tools to Excalidraw tools", () => {
    expect(excalidrawToolType("rect")).toBe("rectangle");
    expect(excalidrawToolType("pen")).toBe("freedraw");
    expect(excalidrawToolType("mosaic")).toBe("selection");
  });

  it("shows the secondary style bar only for Excalidraw drawing tools", () => {
    expect(isExcalidrawStyleTool("rect")).toBe(true);
    expect(isExcalidrawStyleTool("text")).toBe(true);
    expect(isExcalidrawStyleTool("eraser")).toBe(false);
    expect(isExcalidrawStyleTool("mosaic")).toBe(false);
  });

  it("limits a mixed selection to compatible style properties", () => {
    expect(excalidrawStyleCapabilities(["rect", "ellipse"])).toMatchObject({
      fill: true,
      lineStyle: true,
      roughness: true,
    });
    expect(excalidrawStyleCapabilities(["rect", "arrow"])).toMatchObject({
      fill: false,
      arrow: false,
      lineStyle: true,
      roughness: true,
    });
    expect(excalidrawStyleCapabilities(["text", "rect"])).toMatchObject({
      strokeWidth: false,
      fill: false,
    });
  });

  it("keeps export dimensions equal to the capture with no scale change", () => {
    expect(captureExportDimensions(1337, 751)).toEqual({ width: 1337, height: 751, scale: 1 });
  });

  it("keeps the source canvas exposed until the editor background is ready", () => {
    expect(screenshotEditorPresentation(false)).toEqual({ dataReady: "false", ariaHidden: true });
    expect(screenshotEditorPresentation(true)).toEqual({ dataReady: "true", ariaHidden: false });
  });

  it("does not request a host update for an unchanged selection", () => {
    const single: ExcalidrawSelectionState = {
      tool: "rect",
      tools: ["rect"],
      count: 1,
      strokeColor: "#e03131",
      strokeWidth: 3,
      lineStyle: "solid",
      fillColor: "transparent",
      fillStyle: "none",
      roughness: 1,
    };
    expect(isSameExcalidrawSelection(single, { ...single, tools: ["rect"] })).toBe(true);
    expect(isSameExcalidrawSelection(
      { tool: null, tools: [], count: 0 },
      { tool: null, tools: [], count: 0 },
    )).toBe(true);
    expect(isSameExcalidrawSelection(single, { ...single, count: 2, tools: ["rect", "rect"] })).toBe(false);
    expect(isSameExcalidrawSelection(single, { ...single, strokeWidth: 6 })).toBe(false);
  });
});
