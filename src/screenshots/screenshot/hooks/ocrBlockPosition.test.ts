import { describe, expect, it } from "vitest";
import { ocrBlockPosition } from "./usePinOcr";

describe("原位置选字坐标", () => {
  it("物理像素映射为比例，显示缩放后仍覆盖同一文字", () => {
    const block = { x: 200, y: 100, width: 400, height: 50, text: "中文 text", confidence: 1 };
    expect(ocrBlockPosition(block, 2000, 1000)).toEqual({
      left: "10%",
      top: "10%",
      width: "20%",
      height: "5%",
    });
    expect(
      ocrBlockPosition({ ...block, x: 100, y: 50, width: 200, height: 25 }, 1000, 500),
    ).toEqual(ocrBlockPosition(block, 2000, 1000));
  });
});
