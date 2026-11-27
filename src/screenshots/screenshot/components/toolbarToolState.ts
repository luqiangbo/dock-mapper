import type { AnnotTool } from "./AnnotationToolbar";

export interface ToolbarToolTransition {
  nextTool: AnnotTool;
  dismissQr: boolean;
  hideTranslation: boolean;
}

export interface ToolbarModeTransition {
  resetDrawingTool: boolean;
  dismissQr: boolean;
  hideTranslation: boolean;
}

/**
 * Screenshot toolbar enforces a single active tool/mode at a time while keeping
 * automatic OCR selection available whenever returning to the default `"select"` tool.
 */
export function resolveToolbarToolSelection(
  currentTool: AnnotTool,
  clickedTool: AnnotTool,
  allowToggleOff = true,
): ToolbarToolTransition {
  const normalizedCurrent = currentTool ?? "select";
  const normalizedClicked = clickedTool ?? "select";
  if (normalizedClicked === "select") {
    return {
      nextTool: "select",
      dismissQr: false,
      hideTranslation: false,
    };
  }
  if (allowToggleOff && normalizedCurrent === normalizedClicked) {
    return {
      nextTool: "select",
      dismissQr: false,
      hideTranslation: false,
    };
  }
  return {
    nextTool: normalizedClicked,
    dismissQr: true,
    hideTranslation: true,
  };
}

export function resolveToolbarModeAction(
  mode: "translate" | "qr",
  currentlyActive: boolean,
): ToolbarModeTransition {
  if (currentlyActive) {
    return {
      resetDrawingTool: false,
      dismissQr: false,
      hideTranslation: false,
    };
  }
  return {
    resetDrawingTool: true,
    dismissQr: mode === "translate",
    hideTranslation: mode === "qr",
  };
}
