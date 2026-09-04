import { describe, expect, it, vi } from "vitest";
import { ARROW_STYLE_OPTIONS } from "./annotationTypes";
import type { ArrowStyle } from "./annotationTypes";
import { calculateArrowGeometry, drawArrow } from "./arrowGeometry";

function geometry(
  start: { x: number; y: number },
  end: { x: number; y: number },
  style: ArrowStyle = "filled",
  lineWidth = 2,
  canvasScale = 1,
) {
  const result = calculateArrowGeometry({
    start,
    end,
    style,
    lineWidth,
    canvasScale,
    headScale: 1,
  });
  expect(result).not.toBeNull();
  return result!;
}

function mockContext() {
  return {
    lineWidth: 2,
    lineCap: "butt",
    lineJoin: "miter",
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    measureText: vi.fn(() => ({ width: 24 })),
    strokeText: vi.fn(),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("arrow geometry", () => {
  it("calculates closed head corners for horizontal, vertical and reverse directions", () => {
    const horizontal = geometry({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(horizontal.heads[0].baseCenter).toEqual({ x: 88, y: 0 });
    expect(horizontal.heads[0].leftBase).toEqual({ x: 88, y: 6 });
    expect(horizontal.heads[0].rightBase).toEqual({ x: 88, y: -6 });

    const vertical = geometry({ x: 0, y: 0 }, { x: 0, y: 100 });
    expect(vertical.heads[0].baseCenter).toEqual({ x: 0, y: 88 });
    expect(vertical.heads[0].leftBase).toEqual({ x: -6, y: 88 });

    const reverse = geometry({ x: 100, y: 0 }, { x: 0, y: 0 });
    expect(reverse.heads[0].baseCenter).toEqual({ x: 12, y: 0 });

    const diagonal = geometry({ x: 0, y: 0 }, { x: 100, y: 100 });
    const baseOffset = {
      x: diagonal.heads[0].leftBase.x - diagonal.heads[0].baseCenter.x,
      y: diagonal.heads[0].leftBase.y - diagonal.heads[0].baseCenter.y,
    };
    expect(baseOffset.x * diagonal.direction.x + baseOffset.y * diagonal.direction.y).toBeCloseTo(
      0,
    );
  });

  it("stops the shaft at the center of the head base", () => {
    const result = geometry({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(result.shaftEnd).toEqual(result.heads[0].baseCenter);
    expect(result.heads[0].filled).toBe(true);
  });

  it("keeps short double-headed arrows ordered and finite", () => {
    const result = geometry({ x: 0, y: 0 }, { x: 10, y: 0 }, "double", 12);
    expect(result.heads).toHaveLength(2);
    expect(result.shaftStart.x).toBeLessThan(result.shaftEnd.x);
    for (const value of [result.headLength, result.shaftStart.x, result.shaftEnd.x])
      expect(Number.isFinite(value)).toBe(true);
  });

  it("keeps the logical head size stable across canvas scales", () => {
    const at1x = geometry({ x: 0, y: 0 }, { x: 200, y: 0 }, "filled", 3, 1);
    const at15x = geometry({ x: 0, y: 0 }, { x: 300, y: 0 }, "filled", 4.5, 1.5);
    const at2x = geometry({ x: 0, y: 0 }, { x: 400, y: 0 }, "filled", 6, 2);
    expect(at1x.headLength).toBeCloseTo(at15x.headLength / 1.5);
    expect(at1x.headLength).toBeCloseTo(at2x.headLength / 2);
  });

  it("draws an open V head without filling it", () => {
    const context = mockContext();
    drawArrow(context, { x: 0, y: 0 }, { x: 100, y: 0 }, "chevron", 1, 1);
    expect(context.closePath).not.toHaveBeenCalled();
    expect(context.stroke).toHaveBeenCalledTimes(2);
    expect(context.fill).not.toHaveBeenCalled();
  });

  it("fills closed single and double arrow heads", () => {
    const single = mockContext();
    drawArrow(single, { x: 0, y: 0 }, { x: 100, y: 0 }, "filled", 1, 1);
    expect(single.closePath).toHaveBeenCalledTimes(1);
    expect(single.fill).toHaveBeenCalledTimes(1);

    const double = mockContext();
    drawArrow(double, { x: 0, y: 0 }, { x: 100, y: 0 }, "double", 1, 1);
    expect(double.closePath).toHaveBeenCalledTimes(2);
    expect(double.fill).toHaveBeenCalledTimes(2);
  });

  it("exposes the five focused arrow styles", () => {
    expect(ARROW_STYLE_OPTIONS).toHaveLength(5);
    expect(ARROW_STYLE_OPTIONS).toEqual([
      { value: "filled", label: "实心箭头" },
      { value: "chevron", label: "V 形箭头" },
      { value: "double", label: "双向箭头" },
      { value: "block", label: "块状箭头" },
      { value: "label", label: "文字箭头" },
    ]);
    expect(new Set(ARROW_STYLE_OPTIONS.map((option) => option.value)).size).toBe(5);
  });

  it.each(ARROW_STYLE_OPTIONS.map((option) => option.value))(
    "draws finite geometry for %s",
    (style) => {
      const result = geometry({ x: 0, y: 0 }, { x: 9, y: 5 }, style, 8);
      for (const value of [result.headLength, result.shaftStart.x, result.shaftStart.y, result.shaftEnd.x, result.shaftEnd.y])
        expect(Number.isFinite(value)).toBe(true);
    },
  );

  it("draws a filled polygon for a block arrow", () => {
    const context = mockContext();
    drawArrow(context, { x: 0, y: 0 }, { x: 100, y: 0 }, "block", 1, 1);
    expect(context.closePath).toHaveBeenCalled();
    expect(context.fill).toHaveBeenCalled();
  });

  it("measures and renders a horizontal label inside a split shaft", () => {
    const context = mockContext();
    drawArrow(context, { x: 0, y: 0 }, { x: 100, y: 0 }, "label", 1, 1, "说明", {
      fontSize: 16,
      color: "#fff",
      font: "sans",
      bold: false,
      strokeColor: "#000",
      strokeWidth: 1,
    });
    expect(context.measureText).toHaveBeenCalledWith("说明");
    expect(context.fillText).toHaveBeenCalledWith("说明", expect.any(Number), expect.any(Number));
  });
});
