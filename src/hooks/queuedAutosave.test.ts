import { describe, expect, it, vi } from "vitest";
import { createQueuedAutosave, takeDetachedAutosaveError, waitForPendingAutosave } from "./queuedAutosave";

describe("页面切换时的自动保存", () => {
  it("离开设置页后仍保存最后一次修改，重新进入时等待写入完成", async () => {
    vi.useFakeTimers();
    let persisted = "旧设置";
    const queue = createQueuedAutosave({
      key: "widget-test",
      delayMs: 400,
      save: async (value: string) => { persisted = value; return value; },
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
      save: async (_value: string): Promise<string> => { throw new Error("磁盘不可写"); },
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
      save: async (value: string) => { writes.push(value); return value; },
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
