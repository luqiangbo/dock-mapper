import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_TOOL_VISUAL_STATE,
  applyVisualPatch,
  visualToolFor,
} from "./useAnnotationController";

describe("annotation tool preferences", () => {
  it("starts every visual tool with the same persisted-color fallback", () => {
    expect(DEFAULT_TOOL_VISUAL_STATE.frame.color).toBe(DEFAULT_ANNOTATION_COLOR);
    expect(DEFAULT_TOOL_VISUAL_STATE.arrow.color).toBe(DEFAULT_ANNOTATION_COLOR);
    expect(DEFAULT_TOOL_VISUAL_STATE.pen.color).toBe(DEFAULT_ANNOTATION_COLOR);
    expect(DEFAULT_TOOL_VISUAL_STATE.highlight.color).toBe(DEFAULT_ANNOTATION_COLOR);
    expect(visualToolFor("ellipse")).toBe("frame");
  });

  it("keeps changed colors scoped to the matching tool", () => {
    const next = applyVisualPatch(DEFAULT_TOOL_VISUAL_STATE, "pen", { color: "#1971c2" });
    expect(next.frame.color).toBe(DEFAULT_ANNOTATION_COLOR);
    expect(next.arrow.color).toBe(DEFAULT_ANNOTATION_COLOR);
    expect(next.pen.color).toBe("#1971c2");
    expect(next.highlight.color).toBe(DEFAULT_ANNOTATION_COLOR);
  });

  it("keeps line styles scoped to their matching tool", () => {
    const next = applyVisualPatch(DEFAULT_TOOL_VISUAL_STATE, "frame", { lineStyle: "dotted" });
    expect(next.frame.lineStyle).toBe("dotted");
    expect(next.arrow.lineStyle).toBe(DEFAULT_TOOL_VISUAL_STATE.arrow.lineStyle);
  });
});
