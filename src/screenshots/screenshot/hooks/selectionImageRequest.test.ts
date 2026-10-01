import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestGeneration } from "./requestGeneration";
import { runSelectionImageRequest } from "./selectionImageRequest";
afterEach(() => vi.unstubAllGlobals());
describe("再次截图时的旧识别请求", () => {
  it("旧截图上传完成后释放图片，不再启动识别", async () => {
    const request = { current: new RequestGeneration() };
    const generation = request.current.next();
    let resolveUpload!: (id: string) => void;
    let uploadStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      uploadStarted = resolve;
    });
    const uploaded = new Promise<string>((resolve) => {
      resolveUpload = resolve;
    });
    const releaseImage = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue("旧文字");
    vi.stubGlobal("window", {
      api: {
        uploadImage: () => {
          uploadStarted();
          return uploaded;
        },
        releaseImage,
      },
    });
    const result = runSelectionImageRequest({
      request,
      generation,
      exportPng: async () => new Uint8Array([1]),
      execute,
    });
    await started;
    request.current.cancel();
    resolveUpload("old-image");
    expect(await result).toBeNull();
    expect(execute).not.toHaveBeenCalled();
    expect(releaseImage).toHaveBeenCalledWith("old-image");
  });
  it("新截图开始后旧 OCR 结果不能成为当前结果", async () => {
    const request = { current: new RequestGeneration() };
    const generation = request.current.next();
    let resolveOcr!: (text: string) => void;
    let ocrStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      ocrStarted = resolve;
    });
    const recognized = new Promise<string>((resolve) => {
      resolveOcr = resolve;
    });
    vi.stubGlobal("window", {
      api: {
        uploadImage: async () => "old-image",
        releaseImage: vi.fn().mockResolvedValue(undefined),
      },
    });
    const result = runSelectionImageRequest({
      request,
      generation,
      exportPng: async () => new Uint8Array([1]),
      execute: () => {
        ocrStarted();
        return recognized;
      },
    });
    await started;
    request.current.next();
    resolveOcr("旧文字");
    expect(await result).toBeNull();
  });
});
