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
  copyPickerHex: () => void;
  exitPicker: () => void;
  clearSelection: () => void;
  deleteSelection: () => void;
  cancel: () => void;
  undo: () => void;
  redo: () => void;
  confirm: () => void;
}

export function useOverlayKeyboard(options: Options): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (options.blocked) return;
      if (
        options.tool === "picker" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.toLowerCase() === "c"
      ) {
        event.preventDefault();
        options.copyPickerHex();
        return;
      }
      if (event.key === "Escape") {
        if (options.tool === "picker") options.exitPicker();
        else if (
          options.hasSelectedText ||
          options.hasSelectedNumber ||
          options.hasSelectedRaster
        )
          options.clearSelection();
        else options.cancel();
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        (options.hasSelectedText || options.hasSelectedNumber || options.hasSelectedRaster) &&
        options.phase === "editing"
      ) {
        event.preventDefault();
        options.deleteSelection();
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "z" &&
        options.phase === "editing"
      ) {
        event.preventDefault();
        if (event.shiftKey) options.redo();
        else options.undo();
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "y" &&
        options.phase === "editing"
      ) {
        event.preventDefault();
        options.redo();
        return;
      }
      if (
        event.key === "Enter" &&
        options.phase === "editing" &&
        options.shotReady &&
        !options.busy
      ) {
        event.preventDefault();
        options.confirm();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [options]);
}
