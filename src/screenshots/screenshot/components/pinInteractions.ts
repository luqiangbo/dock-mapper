import type { PinOptions } from "../../../api/screenshotTypes";
export function pinDoubleClickAction(options: {
  shift: boolean;
  locked: boolean;
  busy: boolean;
  afterDrag: boolean;
  textSelected: boolean;
}): "close" | null {
  return options.shift ||
    options.locked ||
    options.busy ||
    options.afterDrag ||
    options.textSelected
    ? null
    : "close";
}

export function pinKeyAction(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
  options: {
    menuOpen: boolean;
    locked: boolean;
    busy: boolean;
    textSelected: boolean;
  },
): "close-menu" | "close" | "copy" | "save" | null {
  if (event.key === "Escape") {
    if (options.menuOpen) return "close-menu";
    return options.locked || options.busy ? null : "close";
  }
  if (options.busy || event.altKey || event.shiftKey) return null;
  const modifier = event.ctrlKey || event.metaKey;
  if (!modifier) return null;
  const key = event.key.toLowerCase();
  if (key === "c") return options.textSelected ? null : "copy";
  if (key === "s") return "save";
  return null;
}

export function savedPinMatchesDraft(draft: PinOptions | null, saved: PinOptions) {
  return (
    !draft ||
    (draft.opacity === saved.opacity &&
      draft.locked === saved.locked &&
      Boolean(draft.passthrough) === Boolean(saved.passthrough))
  );
}
