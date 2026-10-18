import { describe, expect, it } from "vitest";
import { previewDirection, previewStep } from "./previewNavigation";
describe("原图预览切换", () => {
  it("沿筛选后的顺序切换且首尾不循环，单张或空列表不可切换", () => {
    expect(previewStep(["c", "a", "b"], "a", 1)).toBe("b");
    expect(previewStep(["c", "a", "b"], "a", -1)).toBe("c");
    expect(previewStep(["c", "a", "b"], "c", -1)).toBeNull();
    expect(previewStep(["a"], "a", 1)).toBeNull();
    expect(previewStep([], "a", 1)).toBeNull();
  });
  it("只处理无修饰键的左右方向键，输入及长按不抢占", () => {
    const event = {
      key: "ArrowRight",
      repeat: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
    };
    expect(previewDirection(event, false)).toBe(1);
    expect(previewDirection({ ...event, key: "ArrowLeft" }, false)).toBe(-1);
    expect(previewDirection(event, true)).toBeNull();
    expect(previewDirection({ ...event, ctrlKey: true }, false)).toBeNull();
    expect(previewDirection({ ...event, repeat: true }, false)).toBeNull();
  });
});
