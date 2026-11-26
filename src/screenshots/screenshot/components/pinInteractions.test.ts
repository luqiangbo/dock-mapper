import { describe, expect, it } from "vitest";
import { pinDoubleClickAction, pinKeyAction, savedPinMatchesDraft } from "./pinInteractions";
describe("贴图交互优先级", () => {
  const plain = { shift: false, locked: false, busy: false, afterDrag: false, textSelected: false };
  it("普通双击关闭，Shift 双击不关闭", () => {
    expect(pinDoubleClickAction(plain)).toBe("close");
    expect(pinDoubleClickAction({ ...plain, shift: true })).toBeNull();
  });
  it.each(["locked", "busy", "afterDrag", "textSelected"])("%s 时双击不关闭贴图", (key) => {
    expect(pinDoubleClickAction({ ...plain, [key]: true })).toBeNull();
  });
  it("旧保存回执不能将新草稿标记为已保存", () => {
    expect(
      savedPinMatchesDraft({ opacity: 0.4, locked: true }, { opacity: 0.8, locked: true }),
    ).toBe(false);
    expect(
      savedPinMatchesDraft(
        { opacity: 0.4, locked: true, passthrough: true },
        { opacity: 0.4, locked: true, passthrough: false },
      ),
    ).toBe(false);
    expect(
      savedPinMatchesDraft(
        { opacity: 0.4, locked: true, passthrough: false },
        { opacity: 0.4, locked: true },
      ),
    ).toBe(true);
  });
  it("贴图快捷键支持 Esc 关闭菜单/贴图、Ctrl+C 复制和 Ctrl+S 保存", () => {
    const base = { menuOpen: false, locked: false, busy: false, textSelected: false };
    const key = (k: string, ctrlKey = false) => ({
      key: k,
      ctrlKey,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    });
    expect(pinKeyAction(key("Escape"), { ...base, menuOpen: true })).toBe("close-menu");
    expect(pinKeyAction(key("Escape"), base)).toBe("close");
    expect(pinKeyAction(key("Escape"), { ...base, locked: true })).toBeNull();
    expect(pinKeyAction(key("c", true), base)).toBe("copy");
    expect(pinKeyAction(key("c", true), { ...base, textSelected: true })).toBeNull();
    expect(pinKeyAction(key("s", true), base)).toBe("save");
    expect(pinKeyAction(key("s", true), { ...base, busy: true })).toBeNull();
  });
});
