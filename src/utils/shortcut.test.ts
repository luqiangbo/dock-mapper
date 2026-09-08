import { describe, expect, it } from "vitest";
import { duplicateShortcutFields, parseShortcut, serializeShortcut } from "./shortcut";

describe("shortcut select values", () => {
  it("round-trips two and three key shortcuts in canonical order", () => {
    expect(serializeShortcut({ modifiers: ["Shift", "Control"], key: "S" })).toBe(
      "Control+Shift+S",
    );
    expect(parseShortcut("Ctrl+S")).toEqual({ modifiers: ["Control"], key: "S" });
    expect(parseShortcut("Win+Esc")).toEqual({ modifiers: ["Super"], key: "Escape" });
    expect(parseShortcut("CommandOrControl+Shift+Space")).toEqual({
      modifiers: ["Control", "Shift"],
      key: "Space",
    });
  });

  it("rejects duplicate modifiers and unsupported legacy values", () => {
    expect(parseShortcut("Control+Control+S")).toBeNull();
    expect(parseShortcut("Control+ArrowUp")).toBeNull();
  });

  it("marks every field that shares a shortcut", () => {
    expect(
      duplicateShortcutFields({ capture: "Ctrl+1", pin: "Control+1", history: "Control+2" }, [
        "capture",
        "pin",
        "history",
      ]),
    ).toEqual(["capture", "pin"]);
  });
});
