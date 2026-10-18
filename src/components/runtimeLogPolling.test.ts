import { describe, expect, it, vi } from "vitest";
import {
  createLogPoller,
  filterRuntimeLogs,
  nearLogBottom,
  type LogReadState,
} from "./runtimeLogPolling";
import type { RuntimeLogSnapshot } from "../api/runtimeLogs";
const empty: RuntimeLogSnapshot = { lines: [], truncated: false };
describe("运行日志轮询", () => {
  it("关闭自动刷新后停止定时读取，重新开启立即读取且隐藏页面不轮询", async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(async () => empty);
      const poller = createLogPoller(read, vi.fn());
      poller.setVisible(true);
      await vi.advanceTimersByTimeAsync(0);
      poller.setAutomatic(false);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(read).toHaveBeenCalledTimes(1);
      await poller.refresh();
      expect(read).toHaveBeenCalledTimes(2);
      poller.setAutomatic(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(read).toHaveBeenCalledTimes(3);
      poller.setVisible(false);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(read).toHaveBeenCalledTimes(3);
      poller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("删除后迟到的旧读取不能恢复已删除记录", async () => {
    let done!: (snapshot: RuntimeLogSnapshot) => void;
    const publish = vi.fn();
    const poller = createLogPoller(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
      publish,
    );
    poller.setVisible(true);
    poller.setVisible(false);
    poller.clearSnapshot();
    done({ lines: [], truncated: true });
    await Promise.resolve();
    expect(publish.mock.calls[publish.mock.calls.length - 1]?.[0].snapshot).toEqual(empty);
    expect(publish.mock.calls.some(([state]) => state.snapshot?.truncated)).toBe(false);
    poller.dispose();
  });
  it("缓存的日志页隐藏时手动刷新和窗口可见性通知都不能启动读取", async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(async () => empty);
      const poller = createLogPoller(read, vi.fn());
      poller.setVisible(false);
      await poller.refresh();
      poller.setVisible(false);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(read).not.toHaveBeenCalled();
      poller.setVisible(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(read).toHaveBeenCalledTimes(1);
      poller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  it("页面可见时刷新，隐藏和离页后停止", async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(async () => empty);
      const poller = createLogPoller(read, vi.fn());
      poller.setVisible(true);
      await vi.advanceTimersByTimeAsync(2000);
      expect(read).toHaveBeenCalledTimes(2);
      poller.setVisible(false);
      await vi.advanceTimersByTimeAsync(5000);
      expect(read).toHaveBeenCalledTimes(2);
      poller.setVisible(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(read).toHaveBeenCalledTimes(3);
      poller.dispose();
      await vi.advanceTimersByTimeAsync(5000);
      expect(read).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
  it("旧请求与新刷新不重叠，隐藏期间的旧结果不会覆盖恢复后的日志", async () => {
    let done!: (snapshot: RuntimeLogSnapshot) => void;
    const read = vi
      .fn(async () => empty)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            done = resolve;
          }),
      );
    const publish = vi.fn<(state: LogReadState) => void>();
    const poller = createLogPoller(read, publish);
    poller.setVisible(true);
    poller.setVisible(false);
    poller.setVisible(true);
    expect(read).toHaveBeenCalledTimes(1);
    done({ lines: [], truncated: true });
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(publish.mock.calls.some(([state]) => state.snapshot?.truncated)).toBe(false);
    poller.dispose();
  });
  it("刷新失败保留已有记录，重试成功后清除错误", async () => {
    const states: LogReadState[] = [];
    const read = vi.fn(async () => empty);
    const poller = createLogPoller(read, (state) => states.push(state));
    poller.setVisible(true);
    await vi.waitFor(() => expect(states[states.length - 1].loading).toBe(false));
    read.mockRejectedValueOnce(new Error("读取失败"));
    await poller.refresh();
    expect(states[states.length - 1]).toMatchObject({ snapshot: empty, error: "Error: 读取失败" });
    await poller.refresh();
    expect(states[states.length - 1].error).toBeNull();
    poller.dispose();
  });
  it("向上阅读时停止跟随，回到底部可恢复", () => {
    expect(nearLogBottom(0, 280, 1000)).toBe(false);
    expect(nearLogBottom(720, 280, 1000)).toBe(true);
  });
  it("筛选错误保留时间顺序，切回全部后恢复其他级别", () => {
    const base = { timestamp: "2026-10-17T00:00:00Z", source: "history", message: "操作结果" };
    const lines: RuntimeLogSnapshot["lines"] = [
      { ...base, id: "1", level: "error" },
      { ...base, id: "2", level: "info" },
      { ...base, id: "3", level: "error" },
    ];
    expect(filterRuntimeLogs(lines, "error").map((line) => line.id)).toEqual(["1", "3"]);
    expect(filterRuntimeLogs(lines, "all")).toEqual(lines);
    expect(filterRuntimeLogs(lines, "warn")).toEqual([]);
  });
});
