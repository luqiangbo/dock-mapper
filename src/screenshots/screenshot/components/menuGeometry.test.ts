import { describe, expect, it } from "vitest";
import { clampMenuPosition } from "./menuGeometry";
describe("贴图右键菜单", () => {
  it("使用实际菜单高度避免底部操作超出窗口", () => {
    expect(
      clampMenuPosition(
        { left: 290, top: 190 },
        { width: 184, height: 160 },
        { width: 300, height: 200 },
      ),
    ).toEqual({ left: 108, top: 32 });
  });
  it("紧凑窗口仍保留菜单起点，内容由滚动容器承载", () => {
    expect(
      clampMenuPosition(
        { left: -4, top: -2 },
        { width: 84, height: 64 },
        { width: 100, height: 80 },
      ),
    ).toEqual({ left: 8, top: 8 });
  });
});
