import { describe, expect, it, vi } from "vitest";
import { runImageAction, ImageActionGate } from "./imageActions";

describe("screenshot image actions", () => {
  it("复制处理中阻止重复提交，取消后新截图不被旧任务阻塞", () => {
    const gate = new ImageActionGate();
    const first = gate.begin(0)!;
    expect(gate.begin(first)).toBeNull();
    const next = gate.begin(first + 1)!;
    gate.finish(first);
    expect(gate.begin(next)).toBeNull();
    gate.finish(next);
    expect(gate.begin(next)).not.toBeNull();
  });
  it("restores busy state and reports an upload or consume failure", async () => {
    const busy: boolean[] = [];
    const errors: string[] = [];
    const result = await runImageAction({
      exportPng: async () => new Uint8Array([1]),
      uploadImage: async () => "image-1",
      consumeImage: vi.fn().mockRejectedValue("复制失败"),
      setBusy: (value) => busy.push(value),
      onError: (message) => errors.push(message),
      fallbackError: "无法完成截图操作",
    });

    expect(result).toBe(false);
    expect(busy).toEqual([true, false]);
    expect(errors).toEqual(["复制失败"]);
  });

  it("does not treat a cancelled native save as a committed image", async () => {
    const committed = vi.fn();
    const result = await runImageAction({
      exportPng: async () => new Uint8Array([1]),
      uploadImage: async () => "image-1",
      consumeImage: vi.fn().mockResolvedValue(false),
      onCommitted: committed,
      setBusy: vi.fn(),
      onError: vi.fn(),
      fallbackError: "保存失败",
    });
    expect(result).toBe(false);
    expect(committed).not.toHaveBeenCalled();
  });
});
