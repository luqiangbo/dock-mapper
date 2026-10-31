import { useEffect } from "react";

interface Options {
  blocked: boolean;
  tool: string | null;
  phase: string;
  hasSelectedText: boolean;
  hasSelectedNumber: boolean;
  hasSelectedRaster: boolean;
  shotReady: boolean;
  busy: boolean;
  editorActive?: boolean;
  hasEditorSelection?: boolean;
  isEditingText?: () => boolean;
  dismissTransientPanel?: () => boolean;
  copyPickerHex: () => void;
  exitPicker: () => void;
  clearSelection: () => void;
  returnToSelect: () => void;
  deleteSelection: () => void;
  cancel: () => void;
  undo: () => void;
  redo: () => void;
  confirm: () => void;
  save?: () => void;
  pin?: () => void;
  ocr?: () => void;
  changeTool?: (tool: string) => void;
}

export function overlayKeyAction(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "isComposing">,
  options: Options,
  textInput = false,
):
  | "cancel"
  | "clear"
  | "confirm"
  | "undo"
  | "redo"
  | "picker"
  | "save"
  | "pin"
  | "ocr"
  | `tool:${string}`
  | null {
  if (event.isComposing || event.key === "Process") return null;
  if (textInput || options.isEditingText?.()) return null;
  if (options.blocked) return null;
  if (event.key === "Escape")
    return options.phase === "editing" &&
      (options.hasEditorSelection ||
        options.hasSelectedText ||
        options.hasSelectedNumber ||
        options.hasSelectedRaster)
      ? "clear"
      : "cancel";
  if (options.busy) return null;
  const modifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (modifier && key === "c")
    return options.phase === "editing" && options.shotReady && !options.hasEditorSelection
      ? "confirm"
      : null;
  if (options.phase === "editing" && options.shotReady) {
    if (modifier && !event.shiftKey && key === "s" && options.save) return "save";
    if (modifier && !event.shiftKey && key === "t" && options.pin) return "pin";
    if (!modifier && !event.altKey && event.shiftKey && key === "c" && options.ocr) return "ocr";
    if (!modifier && !event.altKey && event.shiftKey && options.changeTool) {
      const tools: Record<string, string> = {
        "1": "rect",
        "!": "rect",
        "3": "arrow",
        "#": "arrow",
        "4": "number",
        $: "number",
        "5": "pen",
        "%": "pen",
        "6": "highlight",
        "^": "highlight",
        "7": "mosaic",
        "&": "mosaic",
        "8": "text",
        "*": "text",
        "9": "eraser",
        "(": "eraser",
      };
      if (tools[key]) return `tool:${tools[key]}`;
    }
  }
  if (modifier && key === "z" && options.phase === "editing")
    return event.shiftKey ? "redo" : "undo";
  if (modifier && key === "y" && options.phase === "editing") return "redo";
  if (event.key === "Enter" && options.phase === "editing" && options.shotReady) return "confirm";
  // The active pixel-picker owns C/Space/arrows, including its locked sample.
  return null;
}
export function useOverlayKeyboard(options: Options): void {
  useEffect(() => {
    let composing = false;
    const beginComposition = () => {
      composing = true;
    };
    const endComposition = () => {
      composing = false;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (composing || event.isComposing || event.keyCode === 229) return;
      const target = event.target;
      if (
        event.key === "Enter" &&
        target instanceof Element &&
        target.closest("[data-picker-controls]")
      )
        return;
      const textInput =
        target instanceof Element &&
        Boolean(target.closest('input, textarea, [contenteditable="true"]'));
      const action = overlayKeyAction(event, options, textInput);
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (action === "cancel") options.cancel();
      else if (action === "clear") options.clearSelection();
      else if (action === "confirm") options.confirm();
      else if (action === "undo") options.undo();
      else if (action === "redo") options.redo();
      else if (action === "save") options.save?.();
      else if (action === "pin") options.pin?.();
      else if (action === "ocr") options.ocr?.();
      else if (action.startsWith("tool:")) options.changeTool?.(action.slice(5));
      else options.copyPickerHex();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("compositionstart", beginComposition, true);
    window.addEventListener("compositionend", endComposition, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("compositionstart", beginComposition, true);
      window.removeEventListener("compositionend", endComposition, true);
    };
  }, [options]);
}
