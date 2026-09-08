import { describe, expect, it } from "vitest";
import type { ScreenshotConfig } from "../types";
import {
  isLatestSaveRevision,
  validateScreenshotShortcutDraft,
} from "./screenshotSettingsSave";

const config: ScreenshotConfig = {
  shortcut: "Control+1",
  pin_shortcut: "Control+2",
  history_shortcut: "Control+3",
  toggle_pin_shortcut: "Control+Alt+P",
  quick_ocr_shortcut: "Control+Shift+1",
  save_directory: null,
  filename_prefix: "DockMapper",
  color_copy_format: "hex",
  capture_size_unit: "px",
};

describe("screenshot settings auto-save", () => {
  it("reports invalid and duplicate shortcuts before persistence", () => {
    expect(validateScreenshotShortcutDraft({ ...config, shortcut: "Control+ArrowUp" }).invalid)
      .toEqual(["shortcut"]);
    expect(validateScreenshotShortcutDraft({ ...config, pin_shortcut: "Ctrl+1" }).duplicates)
      .toEqual(["shortcut", "pin_shortcut"]);
  });

  it("rejects an old save response after a newer draft revision", () => {
    expect(isLatestSaveRevision(3, 4)).toBe(false);
    expect(isLatestSaveRevision(4, 4)).toBe(true);
  });
});
