import { afterEach, describe, expect, it, vi } from "vitest";
import { observeWorkspaceScroll, scrollOffset, scrollPercent } from "./workspaceScroll";

afterEach(() => vi.unstubAllGlobals());

describe("主内容区刻度与实际滚动位置", () => {
  it("顶部、中间和底部对应 0%、50% 和 100%，拖动可准确返回原位置", () => {
    const dimensions = { scrollHeight: 2200, clientHeight: 600, scrollTop: 800 };
    expect(scrollPercent({ ...dimensions, scrollTop: 0 })).toBe(0);
    expect(scrollPercent(dimensions)).toBe(50);
    expect(scrollPercent({ ...dimensions, scrollTop: 1600 })).toBe(100);
    expect(scrollOffset(dimensions, 50)).toBe(800);
    expect(scrollOffset(dimensions, 100)).toBe(1600);
  });
  it("内容不足一屏或滚动越界时不会出现无效百分比", () => {
    expect(scrollPercent({ scrollHeight: 400, clientHeight: 600, scrollTop: 50 })).toBe(0);
    expect(scrollOffset({ scrollHeight: 400, clientHeight: 600, scrollTop: 0 }, 100)).toBe(0);
    const dimensions = { scrollHeight: 1200, clientHeight: 600, scrollTop: -20 };
    expect(scrollPercent(dimensions)).toBe(0);
    expect(scrollPercent({ ...dimensions, scrollTop: 800 })).toBe(100);
    expect(scrollOffset(dimensions, -10)).toBe(0);
    expect(scrollOffset(dimensions, 110)).toBe(600);
  });
  it("页面位置恢复后读取真实位置，滚动和内容尺寸变化按帧合并，离开时清理监听", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++sequence, callback);
      return sequence;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const flush = () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(0));
    };
    let resize!: () => void;
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const listeners = new Map<string, () => void>();
    const content = {
      scrollHeight: 1600,
      clientHeight: 600,
      scrollTop: 0,
      firstElementChild: {},
      addEventListener: vi.fn((name: string, callback: () => void) =>
        listeners.set(name, callback),
      ),
      removeEventListener: vi.fn((name: string) => listeners.delete(name)),
    };
    const publish = vi.fn();
    const scrolling = vi.fn();
    const stop = observeWorkspaceScroll(content as unknown as HTMLElement, publish, scrolling);
    content.scrollTop = 500; // Parent layout effect restores a previously visited page.
    listeners.get("scroll")!();
    flush();
    expect(scrolling).not.toHaveBeenCalled();
    expect(publish).toHaveBeenLastCalledWith({ percent: 50, overflowing: true });
    expect(observe).toHaveBeenCalledTimes(2);
    expect(content.addEventListener).toHaveBeenCalledWith("scroll", expect.any(Function), {
      passive: true,
    });
    listeners.get("scroll")!();
    resize();
    expect(frames.size).toBe(1);
    content.scrollHeight = 2600;
    flush();
    expect(publish).toHaveBeenLastCalledWith({ percent: 25, overflowing: true });
    expect(scrolling).not.toHaveBeenCalled(); // Resize alone does not animate scrolling.
    content.scrollTop = 2000;
    listeners.get("scroll")!();
    flush();
    expect(publish).toHaveBeenLastCalledWith({ percent: 100, overflowing: true });
    expect(scrolling).toHaveBeenCalledTimes(1);
    content.scrollTop = 0;
    listeners.get("scroll")!();
    flush();
    expect(publish).toHaveBeenLastCalledWith({ percent: 0, overflowing: true });
    expect(scrolling).toHaveBeenCalledTimes(2);
    content.scrollHeight = 500;
    resize();
    flush();
    expect(publish).toHaveBeenLastCalledWith({ percent: 0, overflowing: false });
    resize();
    stop();
    expect(frames.size).toBe(0);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });
});
