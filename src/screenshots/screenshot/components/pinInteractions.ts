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
export function savedPinMatchesDraft(draft: PinOptions | null, saved: PinOptions) {
  return !draft || (draft.opacity === saved.opacity && draft.locked === saved.locked);
}
