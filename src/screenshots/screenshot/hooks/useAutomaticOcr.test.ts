import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleAutomaticOcr } from "./useAutomaticOcr";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("框选后的后台识别", () => {
  it("选区稳定后自动识别一次，完成不会重复提交", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const recognize = vi.fn();
    const cancel = scheduleAutomaticOcr(recognize, vi.fn());
    expect(recognize).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    vi.advanceTimersByTime(1000);
    expect(recognize).toHaveBeenCalledTimes(1);
    cancel();
  });
  it("调整或退出立即失效旧请求，稳定新选区才重新识别", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const old = vi.fn(),
      next = vi.fn(),
      dismiss = vi.fn();
    scheduleAutomaticOcr(old, dismiss)();
    expect(dismiss).toHaveBeenCalledOnce();
    const cancel = scheduleAutomaticOcr(next, dismiss);
    vi.advanceTimersByTime(150);
    expect(old).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
    cancel();
  });
});
