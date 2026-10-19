import { afterEach, describe, expect, it, vi } from "vitest";
import { createRulerActivity } from "./rulerActivity";

afterEach(() => vi.useRealTimers());

describe("刻度条交互反馈", () => {
  it("停止滚动 900 ms 后收敛，持续滚动重新计时", () => {
    vi.useFakeTimers();
    const activity = createRulerActivity();
    activity.setOverflowing(true);
    activity.scroll();
    expect(activity.getSnapshot()).toMatchObject({ active: true, expanded: false });
    vi.advanceTimersByTime(800);
    activity.scroll();
    vi.advanceTimersByTime(899);
    expect(activity.getSnapshot().active).toBe(true);
    vi.advanceTimersByTime(1);
    expect(activity.getSnapshot().active).toBe(false);
  });
  it.each(["hovered", "dragging", "focused"] as const)(
    "%s 期间保持展开，结束后恢复静止",
    (kind) => {
      vi.useFakeTimers();
      const activity = createRulerActivity();
      activity.setOverflowing(true);
      activity.set(kind, true);
      activity.scroll();
      vi.advanceTimersByTime(1000);
      expect(activity.getSnapshot()).toMatchObject({ active: true, expanded: true });
      activity.set(kind, false);
      expect(activity.getSnapshot()).toMatchObject({ active: false, expanded: false });
    },
  );
  it("页面切换或无溢出时清理全部状态和计时器，不向新页面延续提示", () => {
    vi.useFakeTimers();
    const activity = createRulerActivity();
    activity.setOverflowing(true);
    activity.set("dragging", true);
    activity.scroll();
    activity.reset();
    expect(activity.getSnapshot()).toMatchObject({ active: false, expanded: false });
    expect(vi.getTimerCount()).toBe(0);
    activity.scroll();
    expect(activity.getSnapshot().active).toBe(false);
    activity.setOverflowing(true);
    activity.set("focused", true);
    activity.scroll();
    activity.setOverflowing(false);
    expect(activity.getSnapshot()).toMatchObject({ active: false, expanded: false });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("只在可见反馈变化时通知，取消订阅后不再通知", () => {
    vi.useFakeTimers();
    const activity = createRulerActivity();
    const notify = vi.fn();
    const unsubscribe = activity.subscribe(notify);
    activity.setOverflowing(true);
    activity.scroll();
    activity.scroll();
    expect(notify).toHaveBeenCalledTimes(1);
    unsubscribe();
    activity.reset();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
