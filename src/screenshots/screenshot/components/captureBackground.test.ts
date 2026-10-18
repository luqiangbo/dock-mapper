import { describe, expect, it, vi } from "vitest";
import { paintCaptureBackground } from "./captureBackground";
import { calculateSelectionCrop } from "./selectionGeometry";

function fixture() {
  const operations: unknown[][] = [];
  const context = {
    reset: vi.fn(() => {
      operations.push(["reset"]);
    }),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn((...args: unknown[]) => {
      operations.push(["image", context.filter, context.globalAlpha, ...args]);
    }),
    fillRect: vi.fn(() => {
      operations.push(["dim", context.fillStyle]);
    }),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    clip: vi.fn(),
    rect: vi.fn(),
    strokeRect: vi.fn(),
    filter: "brightness(1.06)",
    globalAlpha: 0.3,
    globalCompositeOperation: "multiply",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 99,
  };
  const canvas = {
    width: 400,
    height: 200,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  const image = {} as CanvasImageSource;
  return { context, canvas, image, operations };
}
describe("截图选区背景", () => {
  it("先压暗整个截图，再仅在选区重绘原图，不增亮或更改透明度", () => {
    const { context, canvas, image, operations } = fixture();
    paintCaptureBackground(canvas, image, {
      sourceX: 20,
      sourceY: 30,
      sourceWidth: 100,
      sourceHeight: 80,
    });
    expect(operations).toEqual([
      ["reset"],
      ["image", "none", 1, image, 0, 0, 400, 200],
      ["dim", "rgba(0, 0, 0, 0.55)"],
      ["image", "none", 1, image, 0, 0, 400, 200],
    ]);
    expect(context.rect).toHaveBeenCalledWith(20, 30, 100, 80);
    expect(context.clip).toHaveBeenCalledOnce();
    expect(context.strokeRect).toHaveBeenCalledTimes(2);
    expect(context.restore).toHaveBeenCalledOnce();
  });
  it.each([1, 1.25, 1.5, 2])("%s 倍缩放的边缘选区使用物理像素裁切", (scale) => {
    const { context, canvas, image } = fixture();
    const crop = calculateSelectionCrop(
      { x: 100, y: 50, width: 100, height: 50 },
      200 * scale,
      100 * scale,
      200,
      100,
    );
    paintCaptureBackground(canvas, image, crop);
    expect(context.rect).toHaveBeenCalledWith(100 * scale, 50 * scale, 100 * scale, 50 * scale);
  });
  it("重复绘制重置旧裁切和混合状态，无选区时只显示遮罩", () => {
    const { context, canvas, image } = fixture();
    paintCaptureBackground(
      canvas,
      image,
      { sourceX: 0, sourceY: 0, sourceWidth: 10, sourceHeight: 10 },
      false,
    );
    paintCaptureBackground(canvas, image, null);
    expect(context.reset).toHaveBeenCalledTimes(2);
    expect(context.drawImage).toHaveBeenCalledTimes(3);
    expect(context.globalCompositeOperation).toBe("source-over");
    expect(context.strokeRect).not.toHaveBeenCalled();
  });
});
