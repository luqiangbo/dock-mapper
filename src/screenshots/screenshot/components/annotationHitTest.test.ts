import { describe, expect, it } from "vitest";
import { annotationHitTest } from "./annotationHitTest";
type Element = Parameters<typeof annotationHitTest>[0];
describe("拖动取景框时的对象命中", () => {
  it("线条包围盒内的空白仍可拖动取景框", () => {
    const line = {
      type: "line",
      x: 10,
      y: 20,
      width: 100,
      height: 100,
      angle: 0,
      strokeWidth: 2,
      points: [
        [0, 0],
        [100, 100],
      ],
      locked: false,
      isDeleted: false,
    } as unknown as Element;
    expect(annotationHitTest(line, { x: 50, y: 60 }, 5)).toBe(true);
    expect(annotationHitTest(line, { x: 100, y: 30 }, 5)).toBe(false);
  });
  it("空心矩形边缘编辑对象，内部空白移动取景框", () => {
    const rectangle = {
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 100,
      angle: 0,
      strokeWidth: 2,
      backgroundColor: "transparent",
      locked: false,
      isDeleted: false,
    } as unknown as Element;
    expect(annotationHitTest(rectangle, { x: 10, y: 60 }, 5)).toBe(true);
    expect(annotationHitTest(rectangle, { x: 60, y: 70 }, 5)).toBe(false);
  });
  it("实心多边形内部优先命中标注，而不是移动取景框", () => {
    const badge = {
      type: "line",
      x: 10,
      y: 20,
      width: 48,
      height: 48,
      angle: 0,
      strokeWidth: 1,
      backgroundColor: "#BDE3CF",
      points: [
        [12, 0],
        [36, 0],
        [48, 12],
        [48, 36],
        [36, 48],
        [12, 48],
        [0, 36],
        [0, 12],
        [12, 0],
      ],
      locked: false,
      isDeleted: false,
    } as unknown as Element;
    expect(annotationHitTest(badge, { x: 34, y: 44 }, 0)).toBe(true);
    expect(annotationHitTest(badge, { x: 10, y: 20 }, 0)).toBe(false);
  });
});
