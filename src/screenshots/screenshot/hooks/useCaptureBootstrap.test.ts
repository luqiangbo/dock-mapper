import { describe, expect, it, vi } from "vitest";
import type { FullScreenshot } from "../../../api/screenshotTypes";
import { connectCaptureSurface } from "./useCaptureBootstrap";

const frame: FullScreenshot = {
  url: "capture://frame/1",
  generation: 1,
  displayWidth: 100,
  displayHeight: 100,
  imageWidth: 200,
  imageHeight: 200,
  overlayLabel: "overlay-1",
  windowCandidates: [],
  mode: "screenshot",
};
function fixture() {
  let capture: (label: string) => void = () => {};
  const cleanup = vi.fn();
  const api = {
    onCaptureReady: vi.fn(async (callback: (label: string) => void) => {
      capture = callback;
      return cleanup;
    }),
    overlayReady: vi.fn(async () => {}),
    getFullScreenshot: vi.fn(async () => frame),
    reportCaptureRendered: vi.fn(async () => true),
    reportCaptureFailed: vi.fn(async () => true),
  };
  const options = {
    label: "overlay-1",
    onCapture: vi.fn(async (_frame: FullScreenshot, _isCurrent: () => boolean) => {}),
    onError: vi.fn(),
  };
  return { api, options, cleanup, capture: () => capture("overlay-1") };
}
describe("截图浮层就绪与绘制", () => {
  it("监听成功后才宣布就绪，绘制完成后才请求显示", async () => {
    const f = fixture();
    const dispose = connectCaptureSurface(f.api, () => f.options);
    expect(f.api.overlayReady).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(f.api.overlayReady).toHaveBeenCalledOnce());
    f.capture();
    await vi.waitFor(() =>
      expect(f.api.reportCaptureRendered).toHaveBeenCalledWith(1, "overlay-1"),
    );
    expect(f.options.onCapture).toHaveBeenCalledOnce();
    dispose();
    expect(f.cleanup).toHaveBeenCalledOnce();
  });
  it.each(["读取", "解码", "显示"])("%s 失败上报主窗口并保留本地反馈", async (boundary) => {
    const f = fixture();
    if (boundary === "读取") f.api.getFullScreenshot.mockRejectedValueOnce(new Error("读取失败"));
    if (boundary === "解码") f.options.onCapture.mockRejectedValueOnce(new Error("解码失败"));
    if (boundary === "显示")
      f.api.reportCaptureRendered.mockRejectedValueOnce(new Error("显示失败"));
    const dispose = connectCaptureSurface(f.api, () => f.options);
    await vi.waitFor(() => expect(f.api.overlayReady).toHaveBeenCalled());
    f.capture();
    await vi.waitFor(() =>
      expect(f.api.reportCaptureFailed).toHaveBeenCalledWith(
        "overlay-1",
        `${boundary}失败`,
        boundary === "读取" ? undefined : 1,
      ),
    );
    expect(f.options.onError).toHaveBeenCalledWith(`${boundary}失败`);
    dispose();
  });
  it("监听注册失败也会上报，不提前宣布就绪", async () => {
    const f = fixture();
    f.api.onCaptureReady.mockRejectedValueOnce(new Error("监听注册失败"));
    const dispose = connectCaptureSurface(f.api, () => f.options);
    await vi.waitFor(() => expect(f.api.reportCaptureFailed).toHaveBeenCalled());
    expect(f.api.overlayReady).not.toHaveBeenCalled();
    dispose();
  });
  it("旧解码迟到后不能请求显示或覆盖新的截图", async () => {
    const f = fixture();
    let finish = () => {};
    let oldIsCurrent = () => true;
    f.options.onCapture.mockImplementationOnce(async (_frame, isCurrent) => {
      oldIsCurrent = isCurrent;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const dispose = connectCaptureSurface(f.api, () => f.options);
    await vi.waitFor(() => expect(f.api.overlayReady).toHaveBeenCalled());
    f.capture();
    await vi.waitFor(() => expect(f.options.onCapture).toHaveBeenCalledOnce());
    f.api.getFullScreenshot.mockResolvedValueOnce({ ...frame, generation: 2 });
    f.capture();
    await vi.waitFor(() =>
      expect(f.api.reportCaptureRendered).toHaveBeenCalledWith(2, "overlay-1"),
    );
    expect(oldIsCurrent()).toBe(false);
    finish();
    await Promise.resolve();
    expect(f.api.reportCaptureRendered).toHaveBeenCalledTimes(1);
    dispose();
  });
});
