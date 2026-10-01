import { afterEach, describe, expect, it, vi } from "vitest";
import { createActivityTicker } from "./activityTicker";
afterEach(() => vi.useRealTimers());
describe("按键展示空闲状态", () => {
  it("有内容时更新淡出，清空后停止刷新，再次输入恢复更新", () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const ticker = createActivityTicker(tick, 150);
    ticker.setActive(false);
    vi.advanceTimersByTime(1_000);
    expect(tick).not.toHaveBeenCalled();
    ticker.setActive(true);
    vi.advanceTimersByTime(300);
    expect(tick).toHaveBeenCalledTimes(2);
    ticker.setActive(false);
    vi.advanceTimersByTime(1_000);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    ticker.setActive(true);
    vi.advanceTimersByTime(150);
    expect(tick).toHaveBeenCalledTimes(3);
    ticker.stop();
  });
});
