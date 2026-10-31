import { describe, expect, it } from "vitest";
import { pinDoubleClickAction, savedPinMatchesDraft } from "./pinInteractions";
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
      savedPinMatchesDraft({ opacity: 0.4, locked: true }, { opacity: 0.4, locked: true }),
    ).toBe(true);
  });
});
