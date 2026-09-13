import { describe, expect, it } from "vitest";
import { ARROW_STYLE_OPTIONS, LINE_STYLE_OPTIONS } from "./annotationTypes";
import {
  annotationBounds,
  cloneRasterAnnotations,
  convertFrameAnnotation,
  hitTestAnnotation,
  isPaintableAnnotation,
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
    outline: { enabled: true, color: "#fff", width: 1 },
    fillOpacity: 0,
    arrowStyle: "straight",
    arrowHeadSize: 1,
    opacity: 1,
    mosaicBlock: 12,
  },
};

describe("retained annotation scene", () => {
  it.each(ARROW_STYLE_OPTIONS.map(({ value }) => value))(
    "moves the entire %s arrow within the canvas",
    (arrowStyle) => {
      const arrow: RasterAnnotation = {
        ...rectangle,
        kind: "arrow",
        points: [
          { x: 100, y: 100 },
          { x: 240, y: 140 },
        ],
        style: { ...rectangle.style, arrowStyle },
      };
      const moved = translateAnnotation(arrow, 1000, 1000, 500, 500);
      const bounds = annotationBounds(moved);
      expect(bounds.x + bounds.width).toBeCloseTo(500);
      expect(bounds.y + bounds.height).toBeCloseTo(500);
      expect(moved.id).toBe(arrow.id);
      expect(moved.points[1].x - moved.points[0].x).toBeCloseTo(140);
      expect(moved.points[1].y - moved.points[0].y).toBeCloseTo(40);
    },
  );

  it.each(ARROW_STYLE_OPTIONS.map(({ value }) => value))(
    "resizes %s uniformly, including its width, without losing its selection",
    (arrowStyle) => {
      const arrow: RasterAnnotation = {
        ...rectangle,
        kind: "arrow",
        points: [
          { x: 100, y: 100 },
          { x: 240, y: 140 },
        ],
        style: { ...rectangle.style, arrowStyle, strokeWidth: 12 },
      };
      const before = annotationBounds(arrow);
      const target = {
        x: before.x,
        y: before.y,
        width: before.width * 2,
        height: before.height * 1.5,
      };
      const resized = resizeAnnotation(arrow, target);
      const bounds = annotationBounds(resized);
      expect(bounds.x).toBeCloseTo(target.x);
      expect(bounds.y).toBeCloseTo(target.y);
      expect(bounds.width).toBeLessThanOrEqual(target.width + 1e-8);
      expect(bounds.height).toBeLessThanOrEqual(target.height + 1e-8);
      // The drag direction is preserved and the width grows with the shape.
      expect(
        (resized.points[1].x - resized.points[0].x) / (resized.points[1].y - resized.points[0].y),
      ).toBeCloseTo(3.5);
      expect(resized.style.strokeWidth).toBeGreaterThan(12);
      expect(bounds.width).toBeGreaterThan(before.width);
      expect(hitTestAnnotation(resized, resized.points[1])).toBe(true);
    },
  );

  it("keeps the opposite corner fixed when shrinking an arrow from its upper left", () => {
    const arrow: RasterAnnotation = {
      ...rectangle,
      kind: "arrow",
      points: [
        { x: 100, y: 100 },
        { x: 240, y: 140 },
      ],
      style: { ...rectangle.style, arrowStyle: "lightning", strokeWidth: 12 },
    };
    const before = annotationBounds(arrow);
    const target = {
      x: before.x + before.width / 2,
      y: before.y + before.height / 2,
      width: before.width / 2,
      height: before.height / 2,
    };
    const bounds = annotationBounds(resizeAnnotation(arrow, target));
    expect(bounds.x + bounds.width).toBeCloseTo(before.x + before.width);
    expect(bounds.y + bounds.height).toBeCloseTo(before.y + before.height);
  });

  it("sizes an arrow from the width chosen in the toolbar", () => {
    const base: RasterAnnotation = {
      ...rectangle,
      kind: "arrow",
      points: [
        { x: 100, y: 100 },
        { x: 340, y: 100 },
      ],
      style: { ...rectangle.style, arrowStyle: "straight", strokeWidth: 8 },
    };
    const thin = annotationBounds(base);
    const thick = annotationBounds({ ...base, style: { ...base.style, strokeWidth: 18 } });
    expect(thick.height).toBeGreaterThan(thin.height);
    expect(thick.width).toBeGreaterThanOrEqual(thin.width);
  });

  it("includes the visible outline in annotation bounds", () => {
    const withoutOutline = annotationBounds({
      ...rectangle,
      style: {
        ...rectangle.style,
        outline: { ...rectangle.style.outline, enabled: false },
      },
    });
    const withOutline = annotationBounds({
      ...rectangle,
      style: {
        ...rectangle.style,
        outline: { enabled: true, color: "#ffffff", width: 4 },
      },
    });
    expect(withOutline.width).toBeGreaterThan(withoutOutline.width);
    expect(withOutline.height).toBeGreaterThan(withoutOutline.height);
  });

  it("creates nothing from a drag without a usable arrow length", () => {
    const dragged = (x: number, y: number): RasterAnnotation => ({
      ...rectangle,
      kind: "arrow",
      points: [
        { x: 50, y: 50 },
        { x, y },
      ],
      style: { ...rectangle.style, arrowStyle: "straight" },
    });
    expect(isPaintableAnnotation(dragged(52, 51))).toBe(false);
    expect(isPaintableAnnotation(dragged(90, 80))).toBe(true);
    expect(isPaintableAnnotation(rectangle)).toBe(true);
  });

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

  it("keeps the requested visual bounds for wide strokes", () => {
    const resized = resizeAnnotation(
      { ...rectangle, style: { ...rectangle.style, strokeWidth: 20 } },
      { x: 5, y: 7, width: 120, height: 90 },
    );
    expect(annotationBounds(resized)).toEqual({ x: 5, y: 7, width: 120, height: 90 });
  });

  it("treats an old frame without an effect as classic", () => {
    const oldBounds = annotationBounds(rectangle);
    const explicitBounds = annotationBounds({
      ...rectangle,
      style: { ...rectangle.style, shapeEffect: "classic" },
    });
    expect(oldBounds).toEqual(explicitBounds);
  });

  it.each(LINE_STYLE_OPTIONS.map(({ value }) => value))(
    "includes %s frame stroke outside the geometry in selection bounds",
    (lineStyle) => {
      const styled: RasterAnnotation = { ...rectangle, style: { ...rectangle.style, lineStyle } };
      const bounds = annotationBounds(styled);
      expect(bounds.x).toBeLessThan(rectangle.points[0].x);
      expect(bounds.y).toBeLessThan(rectangle.points[0].y);
      expect(bounds.width).toBeGreaterThan(40);
      expect(bounds.height).toBeGreaterThan(40);
    },
  );

  it("converts a selected frame without changing its bounds or style", () => {
    const converted = convertFrameAnnotation(
      { ...rectangle, style: { ...rectangle.style, shapeEffect: "watercolor", fillOpacity: 0.4 } },
      "ellipse",
    );
    expect(converted.kind).toBe("ellipse");
    expect(converted.points).toEqual(rectangle.points);
    expect(converted.style.shapeEffect).toBe("watercolor");
    expect(converted.style.fillOpacity).toBe(0.4);
  });

  it("clones gradient stops so undo snapshots do not share mutable paint state", () => {
    const original: RasterAnnotation = {
      ...rectangle,
      style: {
        ...rectangle.style,
        gradientStops: [
          { offset: 0, color: "#ff0000" },
          { offset: 1, color: "#0000ff" },
        ],
      },
    };
    const cloned = cloneRasterAnnotations([original])[0];
    cloned.style.gradientStops![0].color = "#00ff00";
    expect(original.style.gradientStops![0].color).toBe("#ff0000");
  });

  it("clones outlines so undo snapshots do not share their color", () => {
    const cloned = cloneRasterAnnotations([rectangle])[0];
    cloned.style.outline.color = "#000000";
    expect(rectangle.style.outline.color).toBe("#fff");
  });

  it("includes a long horizontal arrow label in selection and hit testing", () => {
    const labeled: RasterAnnotation = {
      ...rectangle,
      kind: "arrow",
      points: [
        { x: 40, y: 40 },
        { x: 80, y: 40 },
      ],
      style: {
        ...rectangle.style,
        arrowStyle: "label",
        arrowLabel: "需要一起移动的说明",
        arrowLabelStyle: {
          fontSize: 24,
          color: "#fff",
          font: "sans",
          bold: false,
          strokeColor: "#000",
          strokeWidth: 1,
        },
      },
    };
    const bounds = annotationBounds(labeled);
    expect(bounds.width).toBeGreaterThan(140);
    expect(hitTestAnnotation(labeled, { x: bounds.x + 2, y: 40 })).toBe(true);
  });
});
