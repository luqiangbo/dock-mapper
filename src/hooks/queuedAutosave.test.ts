import { describe, expect, it, vi } from "vitest";
import {
  createQueuedAutosave,
  takeDetachedAutosaveError,
  waitForPendingAutosave,
} from "./queuedAutosave";

describe("页面切换时的自动保存", () => {
  it("保留页面离开时立即提交最后一版，重复 flush 不会重复写入，成功回写缓存页面", async () => {
    vi.useFakeTimers();
    try {
      const save = vi.fn(async (value: string) => value);
      const saved: string[] = [];
      const queue = createQueuedAutosave({
        key: "retained-page-flush",
        delayMs: 400,
        save,
        onSuccess: (value, { latest }) => {
          if (latest) saved.push(value);
        },
        onError: vi.fn(),
        onDetachedError: vi.fn(),
        onSavingChange: vi.fn(),
      });
      queue.schedule("第一次修改");
      queue.schedule("最后一次修改");
      const first = queue.flush();
      await queue.flush();
      await first;
      await vi.advanceTimersByTimeAsync(1000);
      expect(save).toHaveBeenCalledExactlyOnceWith("最后一次修改");
      expect(saved).toEqual(["最后一次修改"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("缓存页面保存失败保留草稿和错误，返回后重试成功才更新已保存值", async () => {
    const draft = "用户草稿";
    let saved = "旧值";
    let failure: string | null = null;
    const save = vi
      .fn(async (value: string) => value)
      .mockRejectedValueOnce(new Error("磁盘不可写"));
    const queue = createQueuedAutosave({
      key: "retained-page-retry",
      delayMs: 400,
      save,
      onSuccess: (value) => {
        saved = value;
        failure = null;
      },
      onError: (error) => {
        failure = String(error);
      },
      onDetachedError: vi.fn(),
      onSavingChange: vi.fn(),
    });
    queue.schedule(draft);
    await queue.flush();
    expect(saved).toBe("旧值");
    expect(failure).toContain("磁盘不可写");
    queue.schedule(draft);
    await queue.flush();
    expect(saved).toBe(draft);
    expect(failure).toBeNull();
  });

  it("刷新期间新增修改会使旧读取失效，离开后仍保存新草稿", async () => {
    const saved: string[] = [];
    const queue = createQueuedAutosave({
      key: "retained-page-stale-read",
      delayMs: 400,
      save: async (value: string) => value,
      onSuccess: (value) => {
        saved.push(value);
      },
      onError: vi.fn(),
      onDetachedError: vi.fn(),
      onSavingChange: vi.fn(),
    });
    const reading = queue.invalidate();
    queue.schedule("刷新开始后的新修改");
    expect(queue.isCurrent(reading)).toBe(false);
    await queue.flush();
    expect(saved).toEqual(["刷新开始后的新修改"]);
  });

  it("离开设置页后仍保存最后一次修改，重新进入时等待写入完成", async () => {
    vi.useFakeTimers();
    let persisted = "旧设置";
    const queue = createQueuedAutosave({
      key: "widget-test",
      delayMs: 400,
      save: async (value: string) => {
        persisted = value;
        return value;
      },
      onSuccess: () => undefined,
      onError: () => undefined,
      onDetachedError: () => undefined,
      onSavingChange: () => undefined,
    });
    queue.schedule("新设置");
    queue.detach();
    await waitForPendingAutosave("widget-test");
    expect(persisted).toBe("新设置");
    vi.useRealTimers();
  });

  it("离开设置页后写入失败会向全局反馈", async () => {
    vi.useFakeTimers();
    const failures: string[] = [];
    const queue = createQueuedAutosave({
      key: "failure-test",
      delayMs: 400,
      save: async (_value: string): Promise<string> => {
        throw new Error("磁盘不可写");
      },
      onSuccess: () => undefined,
      onError: () => undefined,
      onDetachedError: (error) => failures.push((error as Error).message),
      onSavingChange: () => undefined,
    });
    queue.schedule("新设置");
    queue.detach();
    await waitForPendingAutosave("failure-test");
    expect(failures).toEqual(["磁盘不可写"]);
    expect((takeDetachedAutosaveError("failure-test") as Error).message).toBe("磁盘不可写");
    vi.useRealTimers();
  });

  it("连续修改后离开页面只保存最后一版草稿", async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const queue = createQueuedAutosave({
      key: "latest-test",
      delayMs: 400,
      save: async (value: string) => {
        writes.push(value);
        return value;
      },
      onSuccess: () => undefined,
      onError: () => undefined,
      onDetachedError: () => undefined,
      onSavingChange: () => undefined,
    });
    queue.schedule("第一版");
    queue.schedule("最后一版");
    queue.detach();
    await waitForPendingAutosave("latest-test");
    expect(writes).toEqual(["最后一版"]);
    vi.useRealTimers();
  });
});
