import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadView } from "./loadView";
import { isModuleResourceError } from "../components/pageFailure";
describe("界面按需加载", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("快速加载立即可用，失败保留原始原因", async () => {
    await expect(loadView(async () => "界面")).resolves.toBe("界面");
    await expect(
      loadView(async () => {
        throw new Error("资源缺失");
      }),
    ).rejects.toThrow("资源缺失");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("资源无响应时显示可重新加载的错误，迟到资源不会覆盖失败", async () => {
    let finish!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const view = loadView(() => pending);
    const failed = expect(view).rejects.toThrow("界面模块加载超时");
    await vi.advanceTimersByTimeAsync(15000);
    await failed;
    finish("迟到界面");
    await expect(view).rejects.toThrow("界面模块加载超时");
    expect(isModuleResourceError("Error: 界面模块加载超时，请重新加载界面")).toBe(true);
  });
});
