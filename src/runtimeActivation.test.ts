import { describe, expect, it, vi } from "vitest";
vi.mock("./api/ipc", () => ({ invokeCommand: vi.fn() }));
import { acceptStartupStatus } from "./runtimeActivation";
import type { NativeStartupStatus } from "./api/ipc";
const status = (generation: number, phase: NativeStartupStatus["phase"]): NativeStartupStatus => ({
  generation,
  phase,
  stage: "截图快捷键",
  error: null,
  running: phase === "initializing",
});
describe("运行功能启动状态", () => {
  it("旧尝试与超时后的迟到结果不覆盖新状态", () => {
    const failed = status(2, "failed");
    expect(acceptStartupStatus(failed, status(1, "ready"))).toBe(failed);
    expect(acceptStartupStatus(failed, status(2, "ready"))).toBe(failed);
    expect(acceptStartupStatus(failed, status(3, "initializing")).phase).toBe("initializing");
  });
  it("任务退出后允许失败提示解除等待，保留失败原因", () => {
    const failed = { ...status(2, "failed"), running: true, error: "截图快捷键初始化超时" };
    const finished = { ...failed, running: false };
    expect(acceptStartupStatus(failed, finished)).toBe(finished);
  });
});
