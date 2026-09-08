import { describe, expect, it, vi } from "vitest";
import { ARROW_STYLE_OPTIONS, type ArrowStyle } from "./annotationTypes";
import { arrowSeed, calculateArrowGeometry, drawArrow } from "./arrowGeometry";

function geometry(style: ArrowStyle = "straight", lineWidth = 2, canvasScale = 1) {
  const result = calculateArrowGeometry({
    start: { x: 0, y: 0 },
    end: { x: 120 * canvasScale, y: 40 * canvasScale },
    style,
    lineWidth: lineWidth * canvasScale,
    canvasScale,
    headScale: 1,
  });
  expect(result).not.toBeNull();
  return result!;
}

function mockContext() {
  return {
    lineWidth: 3,
    lineCap: "butt",
    lineJoin: "miter",
    globalAlpha: 1,
    strokeStyle: "#ff2d2d",
    fillStyle: "#ff2d2d",
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    measureText: vi.fn(() => ({ width: 24 })),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("hand-drawn arrow geometry", () => {
  it("exposes the six reference-inspired presets", () => {
    expect(ARROW_STYLE_OPTIONS).toEqual([
      { value: "loop", label: "回旋" },
      { value: "sweep", label: "扫尾" },
      { value: "straight", label: "直线" },
      { value: "curve", label: "弧线" },
      { value: "block", label: "块状" },
      { value: "zigzag", label: "折线" },
    ]);
  });

  it.each(ARROW_STYLE_OPTIONS.map(({ value }) => value))(
    "keeps %s geometry finite and includes its arrow head",
    (style) => {
      const result = geometry(style);
      const values = [
        result.headLength,
        result.bounds.x,
        result.bounds.y,
        result.bounds.width,
        result.bounds.height,
        ...result.shaftPoints.flatMap(({ x, y }) => [x, y]),
      ];
      expect(values.every(Number.isFinite)).toBe(true);
      expect(result.bounds.x).toBeLessThanOrEqual(result.heads[0].tip.x);
      expect(result.bounds.x + result.bounds.width).toBeGreaterThanOrEqual(result.heads[0].tip.x);
    },
  );

  it("expands curved presets beyond the endpoint-only bounds", () => {
    const curve = calculateArrowGeometry({
      start: { x: 0, y: 0 }, end: { x: 120, y: 0 }, style: "curve",
      lineWidth: 3, canvasScale: 1, headScale: 1,
    })!;
    expect(curve.bounds.height).toBeGreaterThan(20);
  });

  it("keeps logical head size stable across canvas scales", () => {
    expect(geometry("straight", 3, 1).headLength).toBeCloseTo(
      geometry("straight", 3, 2).headLength / 2,
    );
  });

  it("uses a stable texture seed and repeats the same rough strokes", () => {
    expect(arrowSeed("annotation-1")).toBe(arrowSeed("annotation-1"));
    expect(arrowSeed("annotation-1")).not.toBe(arrowSeed("annotation-2"));
    const first = mockContext();
    const second = mockContext();
    drawArrow(first, { x: 0, y: 0 }, { x: 120, y: 0 }, "curve", 1, 1, "", undefined, "same");
    drawArrow(second, { x: 0, y: 0 }, { x: 120, y: 0 }, "curve", 1, 1, "", undefined, "same");
    expect(vi.mocked(first.lineTo).mock.calls).toEqual(vi.mocked(second.lineTo).mock.calls);
    expect(first.stroke).toHaveBeenCalledTimes(6);
  });

  it("draws the block preset as repeated closed crayon outlines", () => {
    const context = mockContext();
    drawArrow(context, { x: 0, y: 0 }, { x: 120, y: 0 }, "block", 1, 1, "", undefined, "block");
    expect(context.closePath).toHaveBeenCalledTimes(3);
    expect(context.stroke).toHaveBeenCalledTimes(3);
  });
});
