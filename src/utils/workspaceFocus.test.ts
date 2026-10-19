import { afterEach, describe, expect, it, vi } from "vitest";
import { focusScrollDelta, revealWorkspaceFocus } from "./workspaceFocus";
afterEach(() => vi.unstubAllGlobals());
describe("固定顶栏下的焦点避让", () => {
  it("只移动被顶栏挡住的元素，保持已经可见的页面位置", () => {
    expect(focusScrollDelta(30, 10, 72)).toBe(-52);
    expect(focusScrollDelta(82, 10, 72)).toBe(0);
    expect(focusScrollDelta(200, 10, 72)).toBe(0);
    expect(focusScrollDelta(45.5, 10.5, 72)).toBe(-37);
  });
  it("使用实际滚动留白避让，不滚动弹层或其他容器中的焦点", () => {
    vi.stubGlobal("getComputedStyle", () => ({ scrollPaddingTop: "72px" }));
    const content = {
      contains: () => true,
      getBoundingClientRect: () => ({ top: 10 }),
      scrollBy: vi.fn(),
    };
    let popup = false;
    const target = {
      closest: () => (popup ? {} : null),
      getBoundingClientRect: () => ({ top: 30 }),
    };
    revealWorkspaceFocus(content as unknown as HTMLElement, target as unknown as HTMLElement);
    expect(content.scrollBy).toHaveBeenCalledWith({ top: -52, behavior: "instant" });
    content.scrollBy.mockClear();
    popup = true;
    revealWorkspaceFocus(content as unknown as HTMLElement, target as unknown as HTMLElement);
    expect(content.scrollBy).not.toHaveBeenCalled();
    content.contains = () => false;
    revealWorkspaceFocus(content as unknown as HTMLElement, target as unknown as HTMLElement);
    expect(content.scrollBy).not.toHaveBeenCalled();
  });
});
