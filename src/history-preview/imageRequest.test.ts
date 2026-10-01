import { describe, expect, it, vi } from "vitest";
import { startImageRequest } from "./imageRequest";
const size = { width: 100, height: 100 };
describe("预览图片生命周期", () => {
  it("快速切图或关闭后，旧读取不会创建图片或发布结果", async () => {
    let resolve!: (value: ArrayBuffer) => void;
    const read = new Promise<ArrayBuffer>((complete) => {
      resolve = complete;
    });
    const createUrl = vi.fn(() => "blob:old");
    const publish = vi.fn();
    const request = startImageRequest(
      { read: () => read, createUrl, decode: async () => size, revokeUrl: vi.fn() },
      publish,
      vi.fn(),
    );
    request.dispose();
    resolve(new ArrayBuffer(1));
    await request.done;
    expect(createUrl).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
  it("解码期间关闭释放原图，解码结果不进入下一张图", async () => {
    let resolve!: (value: typeof size) => void;
    const decoding = new Promise<typeof size>((complete) => {
      resolve = complete;
    });
    const revoke = vi.fn();
    const publish = vi.fn();
    const request = startImageRequest(
      {
        read: async () => new ArrayBuffer(1),
        createUrl: () => "blob:old",
        decode: () => decoding,
        revokeUrl: revoke,
      },
      publish,
      vi.fn(),
    );
    await Promise.resolve();
    request.dispose();
    resolve(size);
    await request.done;
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:old");
    expect(publish).not.toHaveBeenCalled();
  });
  it("解码失败反馈错误，重试可重新读取，退出释放新原图", async () => {
    const fail = vi.fn(),
      publish = vi.fn(),
      revokeUrl = vi.fn();
    const source = {
      read: async () => new ArrayBuffer(1),
      createUrl: () => "blob:image",
      revokeUrl,
      decode: async () => {
        throw new Error("无法解码");
      },
    };
    await startImageRequest(source, publish, fail).done;
    expect(fail).toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalled();
    const retry = startImageRequest({ ...source, decode: async () => size }, publish, fail);
    await retry.done;
    expect(publish).toHaveBeenCalledWith({ url: "blob:image", size });
    retry.dispose();
    expect(revokeUrl).toHaveBeenCalledTimes(2);
  });
});
