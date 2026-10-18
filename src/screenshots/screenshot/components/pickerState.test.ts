import { describe, expect, it } from "vitest";
import {
  INITIAL_PICKER_STATE,
  pickerReducer,
  pickerLensCrop,
  pickerKeyAction,
  pickerPanelPosition,
} from "./pickerState";
describe("锁定像素取色", () => {
  it("首次无采样点，移动后预览，单击锁定后鼠标移动不改变像素", () => {
    expect(INITIAL_PICKER_STATE.point).toBeNull();
    const following = pickerReducer(INITIAL_PICKER_STATE, {
      type: "hover",
      point: { x: 12.8, y: 8.9 },
      width: 100,
      height: 80,
    });
    expect(following.point).toEqual({ x: 12, y: 8 });
    const locked = pickerReducer(following, {
      type: "lock",
      point: { x: 12.8, y: 8.9 },
      width: 100,
      height: 80,
    });
    expect(
      pickerReducer(locked, { type: "hover", point: { x: 40, y: 40 }, width: 100, height: 80 }),
    ).toBe(locked);
  });
  it("四个方向每次只移动一个原图像素，抵达边缘后停止", () => {
    const start = { mode: "locked" as const, point: { x: 1, y: 1 } };
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      expect(pickerReducer(start, { type: "nudge", dx, dy, width: 3, height: 3 }).point).toEqual({
        x: 1 + dx,
        y: 1 + dy,
      });
    }
    expect(
      pickerReducer(
        { mode: "locked", point: { x: 0, y: 0 } },
        { type: "nudge", dx: -1, dy: -1, width: 3, height: 3 },
      ).point,
    ).toEqual({ x: 0, y: 0 });
    expect(
      pickerReducer(
        { mode: "locked", point: { x: 2, y: 2 } },
        { type: "nudge", dx: 1, dy: 1, width: 3, height: 3 },
      ).point,
    ).toEqual({ x: 2, y: 2 });
  });
  it("空格恢复跟随，再次进入工具回到未锁定状态", () => {
    const locked = { mode: "locked" as const, point: { x: 12, y: 8 } };
    expect(pickerReducer(locked, { type: "toggle" }).mode).toBe("following");
    expect(pickerReducer(locked, { type: "reset" })).toBe(INITIAL_PICKER_STATE);
  });
  it("边缘放大图保留中心像素位置，不将边缘像素拉伸铺满", () => {
    expect(pickerLensCrop({ x: 0, y: 0 }, 100, 80)).toEqual({
      x: 0,
      y: 0,
      width: 6,
      height: 6,
      left: 60,
      top: 60,
    });
    expect(pickerLensCrop({ x: 99, y: 79 }, 100, 80)).toEqual({
      x: 94,
      y: 74,
      width: 6,
      height: 6,
      left: 0,
      top: 0,
    });
  });
  it("取色快捷键不接管整图复制、关闭、输入框和按钮空格操作", () => {
    const key = {
      key: "ArrowUp",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      isComposing: false,
    };
    expect(pickerKeyAction(key, false)).toBe("up");
    expect(pickerKeyAction({ ...key, key: "c" }, false)).toBe("copy");
    expect(pickerKeyAction({ ...key, key: "c", ctrlKey: true }, false)).toBeNull();
    expect(pickerKeyAction({ ...key, key: "Escape" }, false)).toBeNull();
    expect(pickerKeyAction(key, true)).toBeNull();
    expect(pickerKeyAction({ ...key, key: " " }, false, true)).toBeNull();
  });
  it("锁点面板在右下角翻转，留在视口内", () => {
    const value = pickerPanelPosition(
      { x: 990, y: 790 },
      { width: 224, height: 378 },
      { width: 1000, height: 800 },
    );
    expect(value.left).toBeGreaterThanOrEqual(8);
    expect(value.left + 224).toBeLessThanOrEqual(992);
    expect(value.top).toBeGreaterThanOrEqual(8);
    expect(value.top + 378).toBeLessThanOrEqual(792);
  });
});
