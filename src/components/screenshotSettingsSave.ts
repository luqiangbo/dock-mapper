import type { ScreenshotConfig } from "../types";
import { duplicateShortcutFields, parseShortcut } from "../utils/shortcut";

export type ScreenshotShortcutField =
  | "quick_ocr_shortcut"
  | "shortcut"
  | "pin_shortcut"
  | "history_shortcut"
  | "toggle_pin_shortcut";

export const SCREENSHOT_SHORTCUT_FIELDS: readonly ScreenshotShortcutField[] = [
  "quick_ocr_shortcut",
  "shortcut",
  "pin_shortcut",
  "history_shortcut",
  "toggle_pin_shortcut",
];

export function validateScreenshotShortcutDraft(config: ScreenshotConfig): {
  invalid: ScreenshotShortcutField[];
  duplicates: ScreenshotShortcutField[];
} {
  return {
    invalid: SCREENSHOT_SHORTCUT_FIELDS.filter((name) => !parseShortcut(config[name])),
    duplicates: duplicateShortcutFields(config, SCREENSHOT_SHORTCUT_FIELDS),
  };
}

export function isLatestSaveRevision(requestRevision: number, currentRevision: number): boolean {
  return requestRevision === currentRevision;
}
