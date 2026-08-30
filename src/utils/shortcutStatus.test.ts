import { describe, expect, it } from "vitest";
import type { ScreenshotConfig } from "../types";
import { resetShortcutConfig, shortcutStatusDisplay } from "./shortcutStatus";

const config: ScreenshotConfig = {
  shortcut: "Control+1",
  pin_shortcut: "Control+2",
  history_shortcut: "Control+3",
  toggle_pin_shortcut: "Control+Alt+P",
  quick_ocr_shortcut: "Control+Shift+1",
  save_directory: null,
  filename_prefix: "DockMapper",
  color_copy_format: "hex",
};

describe("shortcut status presentation", () => {
  it("shows registered, conflict and pending states", () => {
    expect(shortcutStatusDisplay(undefined)).toEqual({ label: "检测中", detail: null });
    expect(
      shortcutStatusDisplay({
        actionId: "capture",
        action: "区域截图",
        shortcut: "Control+1",
        registered: true,
        error: null,
      }),
    ).toEqual({ label: "已注册", color: "success", detail: null });
    expect(
      shortcutStatusDisplay({
        actionId: "capture",
        action: "区域截图",
        shortcut: "Control+1",
        registered: false,
        error: "已被其他应用占用",
      }),
    ).toEqual({ label: "冲突", color: "error", detail: "已被其他应用占用" });
  });

  it("keeps the current config when resetting defaults fails", async () => {
    const error = new Error("快捷键冲突");
    const result = await resetShortcutConfig(config, () => Promise.reject(error));
    expect(result.config).toBe(config);
    expect(result.error).toBe(error);
  });
});
