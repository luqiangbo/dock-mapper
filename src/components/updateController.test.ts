import { describe, expect, it, vi } from "vitest";
import { createUpdateController, updatePercent, type UpdateHandle } from "./updateController";
function handle(version = "2026.1017.1") {
  return {
    version,
    download: vi.fn<UpdateHandle["download"]>(async () => undefined),
    install: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}
describe("软件更新状态", () => {
  it("失败下载的迟到进度不会污染重试中的新下载", async () => {
    const first = handle();
    let oldProgress!: Parameters<UpdateHandle["download"]>[0];
    first.download.mockImplementation(async (receive) => {
      oldProgress = receive;
      throw new Error("连接断开");
    });
    const second = handle();
    let finish!: () => void;
    second.download.mockImplementation(async (receive) => {
      receive({ event: "Started", data: { contentLength: 100 } });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const check = vi
      .fn(async () => first)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const controller = createUpdateController({ check, relaunch: async () => undefined });
    await controller.check();
    await controller.install();
    const retry = controller.retry();
    await vi.waitFor(() => expect(controller.getSnapshot().phase).toBe("downloading"));
    oldProgress({ event: "Progress", data: { chunkLength: 90 } });
    expect(controller.getSnapshot().downloaded).toBe(0);
    finish();
    await retry;
  });
  it("资源释放失败可见，仍可重新检查更新", async () => {
    const update = handle();
    update.close.mockRejectedValueOnce(new Error("资源不存在"));
    const check = vi
      .fn<() => Promise<UpdateHandle | null>>(async () => update)
      .mockResolvedValueOnce(update)
      .mockResolvedValueOnce(null);
    const controller = createUpdateController({ check, relaunch: async () => undefined });
    await controller.check();
    await controller.check();
    expect(controller.getSnapshot().phase).toBe("latest");
    expect(controller.getSnapshot().warning).toContain("清理上一次更新失败");
  });
  it("检查无更新、有更新和失败后重试分别可见", async () => {
    const update = handle();
    const check = vi.fn<() => Promise<UpdateHandle | null>>(async () => null);
    const controller = createUpdateController({ check, relaunch: vi.fn(async () => undefined) });
    await controller.check();
    expect(controller.getSnapshot().phase).toBe("latest");
    check.mockRejectedValueOnce(new Error("网络断开"));
    await controller.check();
    expect(controller.getSnapshot()).toMatchObject({ phase: "error", failedAt: "check" });
    check.mockResolvedValueOnce(update);
    await controller.retry();
    expect(controller.getSnapshot()).toMatchObject({ phase: "available", version: update.version });
  });
  it("已知大小显示下载进度，完成下载后才进入安装和重启", async () => {
    const update = handle();
    const phases: string[] = [];
    let finish!: () => void;
    update.download.mockImplementation(async (receive) => {
      receive({ event: "Started", data: { contentLength: 100 } });
      receive({ event: "Progress", data: { chunkLength: 40 } });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      receive({ event: "Finished" });
    });
    const controller = createUpdateController({
      check: async () => update,
      relaunch: vi.fn(async () => undefined),
    });
    controller.subscribe(() => phases.push(controller.getSnapshot().phase));
    await controller.check();
    const pending = controller.install();
    expect(updatePercent(controller.getSnapshot())).toBe(40);
    expect(update.install).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(phases).toContain("installing");
    expect(phases).toContain("restarting");
    expect(controller.getSnapshot().phase).toBe("ready");
  });
  it("未知大小显示已下载字节，下载中离页再订阅不会重复下载", async () => {
    const update = handle();
    let finish!: () => void;
    update.download.mockImplementation(async (receive) => {
      receive({ event: "Started", data: {} });
      receive({ event: "Progress", data: { chunkLength: 45 } });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const controller = createUpdateController({
      check: async () => update,
      relaunch: async () => undefined,
    });
    await controller.check();
    const off = controller.subscribe(vi.fn());
    const pending = controller.install();
    off();
    controller.subscribe(vi.fn());
    await controller.install();
    await controller.check();
    expect(update.download).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().downloaded).toBe(45);
    expect(updatePercent(controller.getSnapshot())).toBeUndefined();
    finish();
    await pending;
  });
  it("下载和安装错误分别说明失败阶段，重试使用新资源", async () => {
    for (const stage of ["download", "install"] as const) {
      const first = handle();
      first[stage].mockRejectedValueOnce(new Error("拒绝访问"));
      const second = handle();
      const check = vi
        .fn(async () => first)
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second);
      const controller = createUpdateController({ check, relaunch: async () => undefined });
      await controller.check();
      await controller.install();
      expect(controller.getSnapshot()).toMatchObject({ phase: "error", failedAt: stage });
      await controller.retry();
      expect(first.close).toHaveBeenCalledTimes(1);
      expect(second.download).toHaveBeenCalledTimes(1);
      expect(second.install).toHaveBeenCalledTimes(1);
      expect(controller.getSnapshot().phase).toBe("ready");
    }
  });
  it("重启失败只重试重启，安装失败后发现新版本时重新等待确认", async () => {
    const update = handle();
    const relaunch = vi.fn(async () => undefined).mockRejectedValueOnce(new Error("重启失败"));
    const controller = createUpdateController({ check: async () => update, relaunch });
    await controller.check();
    await controller.install();
    await controller.retry();
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(2);
    const first = handle();
    first.install.mockRejectedValueOnce(new Error("安装失败"));
    const next = handle("2026.1017.2");
    const check = vi
      .fn(async () => first)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(next);
    const changed = createUpdateController({ check, relaunch });
    await changed.check();
    await changed.install();
    await changed.retry();
    expect(changed.getSnapshot()).toMatchObject({ phase: "available", version: next.version });
    expect(next.download).not.toHaveBeenCalled();
  });
});
