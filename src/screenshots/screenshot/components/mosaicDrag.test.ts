import { describe, expect, it } from "vitest";
import { MosaicDrag } from "./mosaicDrag";

describe("马赛克拖动提交", () => {
  it("松开只提交一次，预览与提交区域相同", () => {
    const drag = new MosaicDrag();
    drag.begin(1, { x: 10, y: 20 }, "capture-1:viewport-1");
    drag.move(1, { x: 50, y: 60 }, "capture-1:viewport-1");
    const preview = drag.bounds(100, 100, "capture-1:viewport-1");
    expect(drag.finish(1, { x: 50, y: 60 }, "capture-1:viewport-1", 100, 100)).toEqual(preview);
    expect(drag.finish(1, { x: 50, y: 60 }, "capture-1:viewport-1", 100, 100)).toBeNull();
  });
  it.each(["capture-2:viewport-1", "capture-1:viewport-2"])("%s 的旧拖动不能提交", (key) => {
    const drag = new MosaicDrag();
    drag.begin(1, { x: 10, y: 20 }, "capture-1:viewport-1");
    expect(drag.finish(1, { x: 50, y: 60 }, key, 100, 100)).toBeNull();
  });
  it("取消或点击不留下图层，其他指针不能提交当前拖动", () => {
    const drag = new MosaicDrag();
    drag.begin(1, { x: 10, y: 20 }, "session");
    expect(drag.finish(2, { x: 50, y: 60 }, "session", 100, 100)).toBeNull();
    expect(drag.owns(1)).toBe(true);
    drag.cancel();
    expect(drag.finish(1, { x: 50, y: 60 }, "session", 100, 100)).toBeNull();
    drag.begin(1, { x: 10, y: 20 }, "session");
    expect(drag.finish(1, { x: 10, y: 20 }, "session", 100, 100)).toBeNull();
  });
});
