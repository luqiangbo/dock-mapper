import { describe, expect, it, vi } from "vitest";
import { installBrowserContextMenuPolicy } from "./browserContextMenu";
describe("全窗口浏览器右键策略", () => {
  it("阻止默认菜单但仍把事件交给应用菜单，鼠标及键盘事件不被拦截", () => {
    const target = new EventTarget();
    const dispose = installBrowserContextMenuPolicy(target);
    const menu = vi.fn();
    target.addEventListener("contextmenu", menu);
    const event = new Event("contextmenu", { cancelable: true });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(menu).toHaveBeenCalledOnce();
    for (const type of ["mousedown", "mouseup", "keydown"]) {
      const other = new Event(type, { cancelable: true });
      target.dispatchEvent(other);
      expect(other.defaultPrevented).toBe(false);
    }
    dispose();
    const next = new Event("contextmenu", { cancelable: true });
    target.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
  });
  it("重复注册只安装一次，热更新清理后可以重新挂载", () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, "addEventListener");
    const first = installBrowserContextMenuPolicy(target);
    expect(installBrowserContextMenuPolicy(target)).toBe(first);
    expect(add).toHaveBeenCalledTimes(1);
    first();
    const next = installBrowserContextMenuPolicy(target);
    first();
    expect(target.dispatchEvent(new Event("contextmenu", { cancelable: true }))).toBe(false);
    next();
  });
});
