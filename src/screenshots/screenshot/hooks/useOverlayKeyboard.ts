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
}

export function overlayKeyAction(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "isComposing">,
  options: Options,
  textInput = false,
): "cancel" | "confirm" | "undo" | "redo" | "picker" | null {
  if (event.isComposing || event.key === "Process") return null;
  if (event.key === "Escape") return "cancel";
  if (textInput || options.isEditingText?.()) return null;
  const modifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (modifier && key === "c")
    return options.phase === "editing" && options.shotReady && !options.busy ? "confirm" : null;
  if (options.blocked || options.busy) return null;
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
      else if (action === "confirm") options.confirm();
      else if (action === "undo") options.undo();
      else if (action === "redo") options.redo();
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
