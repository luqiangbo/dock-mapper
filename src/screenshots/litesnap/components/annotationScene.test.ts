import { describe, expect, it } from "vitest";
import {
  annotationBounds,
  hitTestAnnotation,
  resizeAnnotation,
  simplifyScenePoints,
  translateAnnotation,
  type RasterAnnotation,
} from "./annotationScene";

const rectangle: RasterAnnotation = {
  id: "rect-1",
  kind: "rect",
  points: [
    { x: 10, y: 20 },
    { x: 50, y: 60 },
  ],
  style: {
    color: "#fff",
    strokeWidth: 2,
    fillOpacity: 0,
    arrowStyle: "filled",
    arrowHeadSize: 1,
    opacity: 1,
    mosaicBlock: 12,
  },
};

describe("retained annotation scene", () => {
  it("simplifies dense pointer paths while preserving endpoints", () => {
    expect(
      simplifyScenePoints([
        { x: 0, y: 0 },
        { x: 0.1, y: 0.1 },
        { x: 2, y: 2 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 2 },
    ]);
  });

  it("hit-tests and clamps translated annotations to the canvas", () => {
    expect(hitTestAnnotation(rectangle, { x: 30, y: 40 })).toBe(true);
    const moved = translateAnnotation(rectangle, 1000, 1000, 100, 100);
    const bounds = annotationBounds(moved);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(100);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(100);
  });

  it("scales every geometry point into new bounds", () => {
    const resized = resizeAnnotation(rectangle, { x: 0, y: 0, width: 100, height: 80 });
    const bounds = annotationBounds(resized);
    expect(bounds.x).toBeCloseTo(0);
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.width).toBeCloseTo(100);
    expect(bounds.height).toBeCloseTo(80);
  });
});
