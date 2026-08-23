import { describe, expect, it } from "vitest";
import { shortcutFromKeyEvent } from "./shortcut";

describe("shortcut recorder", () => {
  it("records stable Tauri accelerator names", () => {
    expect(
      shortcutFromKeyEvent({
        ctrlKey: true,
        altKey: false,
        shiftKey: true,
        metaKey: false,
        code: "KeyA",
        key: "a",
      }),
    ).toBe("Control+Shift+A");
  });

  it("rejects a key without a modifier", () => {
    expect(
      shortcutFromKeyEvent({
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        code: "KeyA",
        key: "a",
      }),
    ).toBeNull();
  });
});
