import { describe, expect, it, vi } from "vitest";
import { captureStarting, createCaptureStartup } from "./captureStartup";

describe("截图启动反馈", () => {
  it("先监听，命令返回后仍加载，直到浮层实际显示", async () => {
    const flow = createCaptureStartup();
    const calls: string[] = [];
    await flow.start(
      async () => {
        calls.push("invoke");
        return 1;
      },
      async () => {
        calls.push("listen");
      },
    );
    expect(calls).toEqual(["listen", "invoke"]);
    expect(captureStarting(flow.getSnapshot())).toBe(true);
    flow.receive({ generation: 1, phase: "shown", error: null });
    expect(captureStarting(flow.getSnapshot())).toBe(false);
  });
  it.each(["shown", "failed"] as const)("命令响应前的 %s 事件不会被启动状态覆盖", async (phase) => {
    const flow = createCaptureStartup();
    await flow.start(
      async () => {
        flow.receive({ generation: 1, phase, error: phase === "failed" ? "图片解码失败" : null });
        return 1;
      },
      async () => {},
    );
    expect(flow.getSnapshot().state?.phase).toBe(phase);
    expect(captureStarting(flow.getSnapshot())).toBe(false);
  });
  it("重复点击有明确错误且不重复发送命令", async () => {
    const flow = createCaptureStartup();
    const invoke = vi.fn(async () => 1);
    await flow.start(invoke, async () => {});
    await expect(flow.start(invoke, async () => {})).rejects.toThrow("正在启动");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("超时后可重试，旧代次迟到不会结束新的启动", async () => {
    const flow = createCaptureStartup();
    await flow.start(
      async () => 1,
      async () => {},
    );
    flow.receive({ generation: 1, phase: "failed", error: "截图启动超时（8 秒）" });
    await flow.start(
      async () => 2,
      async () => {},
    );
    flow.receive({ generation: 1, phase: "shown", error: null });
    expect(flow.getSnapshot().state).toEqual({ generation: 2, phase: "starting", error: null });
  });
  it("监听或原生命令失败后恢复重试入口", async () => {
    for (const listenFails of [true, false]) {
      const flow = createCaptureStartup();
      await expect(
        flow.start(
          async () => {
            throw new Error("原生捕获失败");
          },
          async () => {
            if (listenFails) throw new Error("监听失败");
          },
        ),
      ).rejects.toThrow();
      expect(captureStarting(flow.getSnapshot())).toBe(false);
      await expect(
        flow.start(
          async () => 2,
          async () => {},
        ),
      ).resolves.toBe(2);
    }
  });
});
