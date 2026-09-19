import { useCallback, useState } from "react";
import type { AnnotTool } from "../components/AnnotationToolbar";
import { DEFAULT_LINE_STYLE, type LineStyle } from "../components/annotationTypes";

export type VisualTool = "frame" | "line" | "arrow" | "pen" | "highlight";

export interface ToolVisualState {
  frame: { color: string; lineStyle: LineStyle };
  line: { color: string; lineStyle: LineStyle };
  arrow: { color: string; lineStyle: LineStyle };
  pen: { color: string; lineStyle: LineStyle };
  highlight: { color: string; lineStyle: LineStyle };
}

export const DEFAULT_ANNOTATION_COLOR = "#e03131";

export const DEFAULT_TOOL_VISUAL_STATE: ToolVisualState = {
  frame: { color: DEFAULT_ANNOTATION_COLOR, lineStyle: DEFAULT_LINE_STYLE },
  line: { color: DEFAULT_ANNOTATION_COLOR, lineStyle: DEFAULT_LINE_STYLE },
  arrow: { color: DEFAULT_ANNOTATION_COLOR, lineStyle: DEFAULT_LINE_STYLE },
  pen: { color: DEFAULT_ANNOTATION_COLOR, lineStyle: DEFAULT_LINE_STYLE },
  highlight: { color: DEFAULT_ANNOTATION_COLOR, lineStyle: DEFAULT_LINE_STYLE },
};

export function visualToolFor(tool: AnnotTool | string): VisualTool | null {
  if (tool === "rect" || tool === "ellipse" || tool === "diamond") return "frame";
  if (tool === "line" || tool === "arrow" || tool === "pen" || tool === "highlight") return tool;
  return null;
}

export function applyVisualPatch(
  current: ToolVisualState,
  tool: VisualTool,
  patch: { color?: string; lineStyle?: LineStyle },
): ToolVisualState {
  return {
    ...current,
    [tool]: { ...current[tool], ...patch },
  };
}

export function applySharedColor(current: ToolVisualState, color: string): ToolVisualState {
  return {
    ...current,
    frame: { ...current.frame, color },
    line: { ...current.line, color },
    arrow: { ...current.arrow, color },
    pen: { ...current.pen, color },
  };
}

/**
 * Owns annotation preferences that intentionally survive each capture reset.
 * Gesture and history transitions live in the adjacent focused controllers.
 */
export function useAnnotationController(): {
  visuals: ToolVisualState;
  updateVisual: (
    tool: VisualTool,
    patch: { color?: string; lineStyle?: LineStyle },
  ) => void;
  updateSharedColor: (color: string) => void;
} {
  const [visuals, setVisuals] = useState<ToolVisualState>(DEFAULT_TOOL_VISUAL_STATE);
  const updateVisual = useCallback(
    (tool: VisualTool, patch: { color?: string; lineStyle?: LineStyle }): void => {
      setVisuals((current) => applyVisualPatch(current, tool, patch));
    },
    [],
  );
  const updateSharedColor = useCallback((color: string): void => {
    setVisuals((current) => applySharedColor(current, color));
  }, []);
  return { visuals, updateVisual, updateSharedColor };
}
