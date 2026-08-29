import { describe, expect, it, vi } from "vitest";
import { runImageAction } from "./imageActions";

describe("screenshot image actions", () => {
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
