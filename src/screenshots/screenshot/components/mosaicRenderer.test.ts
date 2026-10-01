import { describe, expect, it } from "vitest";
import { blurSampleArea, detectCanvasBlur } from "./mosaicRenderer";

describe("柔和模糊采样边界", () => {
  it("读取选区周边，输出只保留框选区域", () => {
    expect(blurSampleArea({ x: 50, y: 60, width: 20, height: 30 }, 200, 200, 4)).toEqual({
      padding: 16,
      x: 34,
      y: 44,
      width: 52,
      height: 62,
      targetX: 0,
      targetY: 0,
      targetWidth: 52,
      targetHeight: 62,
    });
  });
  it("截图四边使用真实边缘像素填满周边", () => {
    expect(blurSampleArea({ x: 0, y: 0, width: 10, height: 8 }, 10, 8, 2)).toEqual({
      padding: 8,
      x: 0,
      y: 0,
      width: 10,
      height: 8,
      targetX: 8,
      targetY: 8,
      targetWidth: 26,
      targetHeight: 24,
    });
  });
  it("环境缺少滤镜能力时禁用柔和模糊", () => {
    expect(
      detectCanvasBlur(() => ({ getContext: () => ({}) }) as unknown as HTMLCanvasElement),
    ).toBe(false);
  });
  it.each([0, 255, 120])("检测实际像素变化而不是只检测属性存在：%s", (red) => {
    const createCanvas = () =>
      ({
        getContext: () => ({
          filter: "none",
          fillRect() {},
          drawImage() {},
          getImageData: () => ({ data: new Uint8ClampedArray([red, red, red, 255]) }),
        }),
      }) as unknown as HTMLCanvasElement;
    expect(detectCanvasBlur(createCanvas)).toBe(red > 0 && red < 255);
  });
});
