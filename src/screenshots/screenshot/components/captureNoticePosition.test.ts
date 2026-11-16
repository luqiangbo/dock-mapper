import { describe, expect, it } from "vitest";
import { captureNoticePosition, type NoticeBounds } from "./captureNoticePosition";
const metrics = { width: 160, height: 36, viewportWidth: 1280, viewportHeight: 900 };
const frame = { x: 100, y: 160, width: 600, height: 400 };
function rect(position: ReturnType<typeof captureNoticePosition>) {
  return {
    x: parseFloat(position.left),
    y: parseFloat(position.top),
    width: metrics.width,
    height: metrics.height,
  };
}
function overlaps(a: NoticeBounds, b: NoticeBounds) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe("所有截图提示固定在右侧一个位置", () => {
  it("拖动只平移提示，调整大小后继续对齐右边", () => {
    const before = captureNoticePosition(frame, metrics);
    const moved = captureNoticePosition({ ...frame, x: 240, y: 210 }, metrics);
    expect(before.left).toBe("540px");
    expect(parseFloat(moved.left) - parseFloat(before.left)).toBe(140);
    expect(parseFloat(moved.top) - parseFloat(before.top)).toBe(50);
    expect(captureNoticePosition({ ...frame, width: 800 }, metrics).left).toBe("740px");
  });
  it("进度和结果使用相同定位，没有中间展示入口", () => {
    const progress = captureNoticePosition(frame, metrics);
    const completed = captureNoticePosition(frame, metrics);
    expect(completed).toEqual(progress);
    expect(parseFloat(progress.left) + metrics.width).toBe(frame.x + frame.width);
  });
  it("顶部贴边时转到框下方，不覆盖选区", () => {
    const edge = { x: 0, y: 0, width: 500, height: 300 };
    const notice = captureNoticePosition(edge, metrics);
    expect(notice.outside).toBe(true);
    expect(overlaps(rect(notice), edge)).toBe(false);
    expect(notice.top).toBe("308px");
  });
  it("避开坐标面板时只上下调整，保持右对齐", () => {
    const coordinates = { x: 500, y: 116, width: 200, height: 36 };
    const notice = captureNoticePosition(frame, metrics, [coordinates]);
    expect(notice.left).toBe("540px");
    expect(overlaps(rect(notice), coordinates)).toBe(false);
  });
  it("上下空间不足时也不跳到左边，取消选区后保持屏幕右侧", () => {
    const edge = { x: 500, y: 8, width: 772, height: 884 };
    expect(captureNoticePosition(edge, metrics).left).toBe("1112px");
    expect(captureNoticePosition(null, metrics).left).toBe("1104px");
  });
});
