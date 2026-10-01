import { describe, expect, it } from "vitest";
import { mosaicBounds, mosaicGrid, mosaicSampleBounds, pixelatePixels } from "./mosaicPatch";

describe("截图马赛克区域", () => {
  it("正向和反向拖动覆盖相同的物理像素", () => {
    const start = { x: 40.2, y: 20.4 };
    const end = { x: 10.1, y: 4.2 };
    expect(mosaicBounds(start, end, 100, 80)).toEqual({ x: 10, y: 4, width: 31, height: 17 });
    expect(mosaicBounds(end, start, 100, 80)).toEqual(mosaicBounds(start, end, 100, 80));
  });
  it("拖到截图外时只处理截图内的区域", () => {
    expect(mosaicBounds({ x: -20, y: -10 }, { x: 200, y: 100 }, 120, 80)).toEqual({
      x: 0,
      y: 0,
      width: 120,
      height: 80,
    });
    expect(mosaicBounds({ x: 150, y: 90 }, { x: 200, y: 110 }, 120, 80)).toEqual({
      x: 120,
      y: 80,
      width: 0,
      height: 0,
    });
  });
  it("不同显示缩放下保留相同的可见马赛克颗粒大小", () => {
    expect(mosaicGrid(120, 60, 12, 1)).toEqual({ width: 10, height: 5 });
    expect(mosaicGrid(180, 90, 12, 2 / 3)).toEqual({ width: 10, height: 5 });
    expect(mosaicGrid(240, 120, 12, 0.5)).toEqual({ width: 10, height: 5 });
  });
  it("选区宽度变化时仍读取固定的原图网格", () => {
    expect(mosaicSampleBounds({ x: 13, y: 5, width: 15, height: 13 }, 100, 80, 12)).toEqual({
      x: 12,
      y: 0,
      width: 24,
      height: 24,
    });
    expect(mosaicSampleBounds({ x: 13, y: 5, width: 16, height: 13 }, 100, 80, 12)).toEqual({
      x: 12,
      y: 0,
      width: 24,
      height: 24,
    });
    expect(mosaicSampleBounds({ x: 95, y: 75, width: 5, height: 5 }, 100, 80, 12)).toEqual({
      x: 84,
      y: 72,
      width: 16,
      height: 8,
    });
  });
  it("方块取平均颜色，最右侧剩余像素不会被拉伸", () => {
    const values = [0, 100, 200, 20, 120, 220];
    const pixels = new Uint8ClampedArray(values.flatMap((value) => [value, value, value, 255]));
    const result = pixelatePixels(pixels, 3, 2, 2);
    expect(Array.from(result.filter((_, index) => index % 4 === 0))).toEqual([
      60, 60, 210, 60, 60, 210,
    ]);
  });
  it("透明像素的隐藏颜色不会污染方块", () => {
    expect(
      Array.from(pixelatePixels(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 0]), 2, 1, 2)),
    ).toEqual([255, 0, 0, 128, 255, 0, 0, 128]);
  });
  it("重叠选区的同一网格颜色一致", () => {
    const pixels = new Uint8ClampedArray(
      Array.from({ length: 32 }, (_, index) => [
        (index % 8) + Math.floor(index / 8) * 20,
        0,
        0,
        255,
      ]).flat(),
    );
    const large = pixelatePixels(pixels, 8, 4, 4);
    const firstCell = new Uint8ClampedArray(
      Array.from({ length: 4 }, (_, row) =>
        Array.from(pixels.slice(row * 8 * 4, (row * 8 + 4) * 4)),
      ).flat(),
    );
    const small = pixelatePixels(firstCell, 4, 4, 4);
    expect(large.slice((8 + 2) * 4, (8 + 3) * 4)).toEqual(small.slice((4 + 2) * 4, (4 + 3) * 4));
  });
});
