import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARROW_STYLE_OPTIONS,
  ARROW_WIDTHS,
  DEFAULT_ARROW_WIDTH,
  normalizeArrowStyle,
  normalizeArrowWidth,
  type ArrowStyle,
} from "./annotationTypes";
import {
  arrowSeed,
  calculateArrowGeometry,
  clearArrowRenderCache,
  drawArrow,
  hasVisibleArrowLength,
  MIN_ARROW_LENGTH,
} from "./arrowGeometry";
import { arrowOutlinePreview, type ArrowPoint } from "./arrowShapes";
import { createCrayonGrains } from "./crayonBrush";

const SHAPES = ARROW_STYLE_OPTIONS.map(({ value }) => value);

function geometry(style: ArrowStyle = "straight", lineWidth = 12, length = 240) {
  return calculateArrowGeometry({
    start: { x: 0, y: 0 },
    end: { x: length, y: 0 },
    lineWidth,
    style,
  })!;
}

function polygonArea(points: ArrowPoint[]): number {
  return (
    Math.abs(
      points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length];
        return sum + point.x * next.y - next.x * point.y;
      }, 0),
    ) / 2
  );
}

/** Strict crossings only: touching or shared vertices are legal in a ring. */
function selfIntersects(points: ArrowPoint[]): boolean {
  const edges = points
    .slice(1)
    .map((end, index) => [points[index], end] as const)
    .filter(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y) > 1e-9);
  const side = (o: ArrowPoint, a: ArrowPoint, b: ArrowPoint) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const [a, b] = edges[i];
      const [c, d] = edges[j];
      if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true;
    }
  }
  return false;
}

afterEach(() => {
  clearArrowRenderCache();
  vi.unstubAllGlobals();
});

describe("arrow shape geometry", () => {
  it("offers the four area presets and folds legacy values into them", () => {
    expect(SHAPES).toEqual(["straight", "zigzag", "double", "lightning"]);
    expect(normalizeArrowStyle("loop")).toBe("straight");
    expect(normalizeArrowStyle("label")).toBe("straight");
    expect(normalizeArrowWidth(13)).toBe(12);
    expect(normalizeArrowWidth(40)).toBe(18);
    expect(normalizeArrowWidth(Number.NaN)).toBe(DEFAULT_ARROW_WIDTH);
  });

  it.each(SHAPES)("closes %s into a single fillable outline", (style) => {
    const result = geometry(style);
    expect(result.contours).toHaveLength(1);
    const points = result.contours[0];
    expect(points.length).toBeGreaterThan(3);
    expect(points[points.length - 1]).toEqual(points[0]);
    expect(polygonArea(points)).toBeGreaterThan(0);
    for (const point of points) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
      expect(point.x).toBeGreaterThanOrEqual(result.bounds.x - 1e-9);
      expect(point.y).toBeGreaterThanOrEqual(result.bounds.y - 1e-9);
      expect(point.x).toBeLessThanOrEqual(result.bounds.x + result.bounds.width + 1e-9);
      expect(point.y).toBeLessThanOrEqual(result.bounds.y + result.bounds.height + 1e-9);
    }
  });

  it.each(SHAPES)("keeps the %s body and head on one non-crossing perimeter", (style) => {
    for (const [length, width] of [
      [240, 12],
      [60, 18],
      [600, 8],
      [96, 8],
    ] as const) {
      expect(selfIntersects(geometry(style, width, length).contours[0])).toBe(false);
    }
  });

  it("mirrors the double arrow head to head", () => {
    const length = 240;
    const points = geometry("double", 12, length).contours[0];
    const mirrored = points.map((point) => ({ x: length - point.x, y: -point.y }));
    for (const point of mirrored) {
      expect(
        points.some((other) => Math.abs(other.x - point.x) < 1e-9 && Math.abs(other.y - point.y) < 1e-9),
      ).toBe(true);
    }
    expect(geometry("double").heads).toHaveLength(2);
    expect(geometry("straight").heads).toHaveLength(1);
  });

  it("tapers the lightning bolt where the stair keeps an equal width", () => {
    const bolt = geometry("lightning");
    const stair = geometry("zigzag");
    const spread = (points: ArrowPoint[]) =>
      Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y));
    // Both presets fold well beyond their own width.
    expect(spread(bolt.shaftPoints)).toBeGreaterThan(bolt.width * 2);
    expect(spread(stair.shaftPoints)).toBeGreaterThan(stair.width * 2);
    const tailEdge = (points: ArrowPoint[]) => {
      const tail = points[points.length - 2];
      return Math.hypot(points[0].x - tail.x, points[0].y - tail.y);
    };
    expect(tailEdge(stair.contours[0])).toBeCloseTo(stair.width);
    expect(tailEdge(bolt.contours[0])).toBeLessThan(bolt.width * 0.5);
  });

  it("grows the painted area with the selected width", () => {
    const [thin, medium, thick] = ARROW_WIDTHS.map((width) => geometry("straight", width, 400));
    expect([thin.width, medium.width, thick.width]).toEqual([...ARROW_WIDTHS]);
    expect(medium.bounds.height).toBeGreaterThan(thin.bounds.height);
    expect(thick.bounds.height).toBeGreaterThan(medium.bounds.height);
  });

  it.each(SHAPES)("scales %s proportionally when length and width scale together", (style) => {
    const one = geometry(style, 12, 240);
    const two = geometry(style, 24, 480);
    expect(two.width / 2).toBeCloseTo(one.width);
    expect(two.headLength / 2).toBeCloseTo(one.headLength);
    expect(two.bounds.width / 2).toBeCloseTo(one.bounds.width);
    expect(two.bounds.height / 2).toBeCloseTo(one.bounds.height);
  });

  it.each(SHAPES)("accepts short, reversed and diagonal %s drags", (style) => {
    for (const end of [
      { x: 6, y: 0 },
      { x: -140, y: -40 },
      { x: 0, y: 180 },
      { x: -30, y: 30 },
    ]) {
      const result = calculateArrowGeometry({
        start: { x: 0, y: 0 },
        end,
        lineWidth: 12,
        style,
      })!;
      expect(result).not.toBeNull();
      expect(result.width).toBeGreaterThan(0);
      expect(result.width).toBeLessThanOrEqual(12);
      expect(result.headLength).toBeLessThanOrEqual(result.length * 0.25 + 1e-9);
      expect(
        result.contours[0].every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
      ).toBe(true);
      expect(selfIntersects(result.contours[0])).toBe(false);
    }
  });

  it("refuses a drag without a usable arrow length", () => {
    expect(hasVisibleArrowLength({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe(false);
    expect(hasVisibleArrowLength({ x: 10, y: 10 }, { x: 10 + MIN_ARROW_LENGTH, y: 10 })).toBe(true);
    expect(
      calculateArrowGeometry({
        start: { x: 1, y: 1 },
        end: { x: 1, y: 1 },
        lineWidth: 12,
        style: "straight",
      }),
    ).toBeNull();
  });

  it.each(SHAPES)("previews %s from the same outline the canvas fills", (style) => {
    const preview = arrowOutlinePreview(style);
    expect(preview.path.startsWith("M")).toBe(true);
    expect(preview.path.endsWith("Z")).toBe(true);
    const [, , width, height] = preview.viewBox.split(" ").map(Number);
    const bounds = geometry(style, 13, 96).bounds;
    expect(width).toBeCloseTo(bounds.width + 2, 1);
    expect(height).toBeCloseTo(bounds.height + 2, 1);
  });

  it("recreates the same texture while giving distinct annotations different grains", () => {
    const strokes = geometry("zigzag").strokes;
    const first = createCrayonGrains(strokes, 12, 1, arrowSeed("same"));
    expect(createCrayonGrains(strokes, 12, 1, arrowSeed("same"))).toEqual(first);
    expect(createCrayonGrains(strokes, 12, 1, arrowSeed("different"))).not.toEqual(first);
  });

  it("covers the middle of long straight segments, not just their vertices", () => {
    const grains = createCrayonGrains(
      [
        {
          points: [
            { x: 0, y: 0 },
            { x: 500, y: 0 },
          ],
          closed: false,
          taper: false,
        },
      ],
      6,
      1,
      123,
    );
    for (let x = 0; x < 500; x += 20) {
      expect(grains.some((grain) => grain.x >= x && grain.x < x + 20)).toBe(true);
    }
  });

  it("reports unavailable brush resources without leaking a canvas transform", () => {
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    expect(() =>
      drawArrow(context, {
        start: { x: 0, y: 0 },
        end: { x: 120, y: 0 },
        style: "lightning",
        lineWidth: 12,
        canvasScale: 1,
        color: "#ff0000",
      }),
    ).toThrow("无法创建笔刷画布");
    expect(context.restore).toHaveBeenCalledOnce();
  });

  it("draws nothing for a drag shorter than the minimum arrow length", () => {
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    drawArrow(context, {
      start: { x: 4, y: 4 },
      end: { x: 6, y: 5 },
      style: "straight",
      lineWidth: 12,
      canvasScale: 1,
      color: "#ff0000",
    });
    expect(context.save).not.toHaveBeenCalled();
    expect(context.drawImage).not.toHaveBeenCalled();
  });
});
