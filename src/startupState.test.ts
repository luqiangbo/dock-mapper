import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeStartup, type StartupState } from "./startupState";
const pending = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
describe("连续应用初始化状态", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("八秒后只提示耗时较长，不重复调用或错误结束初始化", async () => {
    const task = pending();
    const work = vi.fn(() => task.promise);
    const states: StartupState[] = [];
    const cancel = observeStartup(work, (state) => states.push(state));
    await vi.advanceTimersByTimeAsync(7999);
    expect(states).toEqual([{ phase: "loading", slow: false }]);
    await vi.advanceTimersByTimeAsync(1);
    expect(states[states.length - 1]).toEqual({ phase: "loading", slow: true });
    await vi.advanceTimersByTimeAsync(16000);
    expect(work).toHaveBeenCalledOnce();
    task.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(states[states.length - 1]).toEqual({ phase: "ready" });
    cancel();
  });
  it("快速成功立即展示正常界面，没有最短等待时间或迟到的慢启动提示", async () => {
    const states: StartupState[] = [];
    const cancel = observeStartup(
      async () => {},
      (state) => states.push(state),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual([{ phase: "loading", slow: false }, { phase: "ready" }]);
    await vi.advanceTimersByTimeAsync(9000);
    expect(states).toHaveLength(2);
    cancel();
  });
  it("初始化失败保留具体原因，重试后可以进入界面", async () => {
    const publish = vi.fn();
    const first = observeStartup(async () => {
      throw new Error("设置写入失败");
    }, publish);
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenLastCalledWith({ phase: "error", error: "Error: 设置写入失败" });
    first();
    const next = observeStartup(async () => {}, publish);
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenLastCalledWith({ phase: "ready" });
    next();
  });
  it.each(["resolve", "reject"] as const)(
    "旧请求 %s 不会覆盖新一次启动或卸载后的状态",
    async (finish) => {
      const old = pending();
      const publish = vi.fn();
      const dispose = observeStartup(() => old.promise, publish);
      await vi.advanceTimersByTimeAsync(0);
      dispose();
      const current = observeStartup(async () => {}, publish);
      await vi.advanceTimersByTimeAsync(0);
      const count = publish.mock.calls.length;
      if (finish === "resolve") old.resolve();
      else old.reject(new Error("旧请求失败"));
      await vi.advanceTimersByTimeAsync(9000);
      expect(publish).toHaveBeenCalledTimes(count);
      expect(publish).toHaveBeenLastCalledWith({ phase: "ready" });
      current();
    },
  );
});
