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
  isEditingText?: () => boolean;
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

export function useOverlayKeyboard(options: Options): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (options.blocked) return;
      // Excalidraw owns editing shortcuts (including Escape, delete and
      // undo/redo) while mounted. The host keeps only screenshot confirmation.
      if (options.editorActive) {
        if (
          event.key === "Enter" &&
          options.phase === "editing" &&
          options.shotReady &&
          !options.busy &&
          !options.isEditingText?.()
        ) {
          event.preventDefault();
          options.confirm();
        }
        return;
      }
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
        else if (options.tool && options.tool !== "select") options.returnToSelect();
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
