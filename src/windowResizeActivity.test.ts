import { afterEach, describe, expect, it, vi } from "vitest";
import { createSettledRenderQueue, createWindowResizeActivity } from "./windowResizeActivity";

afterEach(() => vi.useRealTimers());

function frames() {
  let id = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    schedule: (callback: FrameRequestCallback) => {
      callbacks.set(++id, callback);
      return id;
    },
    cancel: (key: number) => {
      callbacks.delete(key);
    },
    count: () => callbacks.size,
    flush: () => {
      const work = [...callbacks.values()];
      callbacks.clear();
      work.forEach((callback) => callback(0));
    },
  };
}

describe("窗口调整只在稳定后恢复绘制", () => {
  it("连续变化合并为一次开始，最后一次变化稳定 200ms 后结束", () => {
    vi.useFakeTimers();
    const activity = createWindowResizeActivity();
    const states: boolean[] = [];
    activity.subscribe(() => states.push(activity.getSnapshot()));
    activity.begin();
    vi.advanceTimersByTime(150);
    activity.begin();
    vi.advanceTimersByTime(199);
    expect(states).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(states).toEqual([true, false]);
    activity.finish();
    expect(states).toEqual([true, false]);
  });

  it("调整期间取消旧帧，稳定后只用最新尺寸和数据绘制一次", () => {
    vi.useFakeTimers();
    const activity = createWindowResizeActivity();
    const clock = frames();
    let data = { width: 800, sample: 1 };
    const rendered: (typeof data)[] = [];
    const queue = createSettledRenderQueue(
      activity,
      () => rendered.push(data),
      clock.schedule,
      clock.cancel,
    );
    queue.request();
    activity.begin();
    expect(clock.count()).toBe(0);
    data = { width: 1200, sample: 2 };
    queue.request();
    data = { width: 1600, sample: 3 };
    queue.request();
    expect(rendered).toEqual([]);
    vi.advanceTimersByTime(200);
    expect(clock.count()).toBe(1);
    clock.flush();
    expect(rendered).toEqual([{ width: 1600, sample: 3 }]);
    queue.dispose();
  });

  it("正常状态合并同一帧更新，卸载后不会恢复旧页面的绘制", () => {
    vi.useFakeTimers();
    const activity = createWindowResizeActivity();
    const clock = frames();
    const render = vi.fn();
    const queue = createSettledRenderQueue(activity, render, clock.schedule, clock.cancel);
    queue.request();
    queue.request();
    expect(clock.count()).toBe(1);
    clock.flush();
    expect(render).toHaveBeenCalledTimes(1);
    activity.begin();
    queue.request();
    queue.dispose();
    vi.advanceTimersByTime(200);
    clock.flush();
    expect(render).toHaveBeenCalledTimes(1);
    queue.request();
    expect(clock.count()).toBe(0);
  });
});
