import { describe, expect, it } from "vitest";
import {
  ARROW_EFFECT_OPTIONS,
  ARROW_STYLE_OPTIONS,
  DEFAULT_ARROW_EFFECT,
  type ArrowEffect,
  type ArrowStyle,
} from "./annotationTypes";
import {
  arrowColorVariants,
  arrowEffectOpacity,
  arrowEffectPadding,
  createArrowFill,
  createArrowMaterial,
} from "./arrowEffects";
import { calculateArrowGeometry } from "./arrowShapes";
import {
  annotationBounds,
  annotationGeometryBounds,
  cloneRasterAnnotations,
  resizeAnnotation,
  type RasterAnnotation,
} from "./annotationScene";
import { BoundedHistory, ObjectMutationTransaction } from "../hooks/useCanvasHistory";

const EFFECTS = ARROW_EFFECT_OPTIONS.map(({ value }) => value);
const SHAPES = ARROW_STYLE_OPTIONS.map(({ value }) => value);

const arrow: RasterAnnotation = {
  id: "effect-arrow",
  kind: "arrow",
  points: [
    { x: 100, y: 150 },
    { x: 380, y: 100 },
  ],
  style: {
    color: "#ee5533",
    strokeWidth: 12,
    fillOpacity: 0,
    arrowStyle: "straight",
    arrowHeadSize: 1,
    opacity: 1,
    mosaicBlock: 12,
  },
};

function geometry(style: ArrowStyle = "straight", lineWidth = 12, length = 240) {
  return calculateArrowGeometry({
    start: { x: 0, y: 0 },
    end: { x: length, y: 0 },
    lineWidth,
    style,
  })!;
}

interface FakeGradient {
  coords: number[];
  stops: Array<[number, string]>;
  addColorStop: (offset: number, color: string) => void;
}
function fakeContext(): CanvasRenderingContext2D {
  return {
    createLinearGradient: (x0: number, y0: number, x1: number, y1: number) => {
      const gradient: FakeGradient = {
        coords: [x0, y0, x1, y1],
        stops: [],
        addColorStop: (offset, color) => gradient.stops.push([offset, color]),
      };
      return gradient as unknown as CanvasGradient;
    },
  } as unknown as CanvasRenderingContext2D;
}

describe("arrow brushes", () => {
  it("offers a solid default and exactly four painting effects", () => {
    expect(DEFAULT_ARROW_EFFECT).toBe("classic");
    expect(EFFECTS).toEqual(["classic", "crayon", "marker", "gradient"]);
  });

  it.each(EFFECTS)("%s fills the geometry silhouette without reshaping it", (effect) => {
    for (const style of SHAPES) {
      const shape = geometry(style);
      const material = createArrowMaterial(shape, {
        width: shape.width,
        scale: 1,
        seed: 91,
        color: "#ee5533",
        effect,
      });
      expect(material.effect).toBe(effect);
      expect(material.outline).toBe(shape.contours);
      expect(material.strokes).toHaveLength(shape.contours.length);
      expect(material.strokes[0].points).toBe(shape.contours[0]);
      expect(material.strokes[0].closed).toBe(true);
    }
  });

  it.each(EFFECTS)("keeps arrow geometry identical when switching to %s", (arrowEffect) => {
    const base = annotationGeometryBounds(arrow);
    expect(annotationGeometryBounds({ ...arrow, style: { ...arrow.style, arrowEffect } })).toEqual(
      base,
    );
  });

  it("asks for brush room without padding solid arrows", () => {
    const classic = arrowEffectPadding("classic", 12);
    expect(arrowEffectPadding(undefined, 12)).toBe(classic);
    expect(arrowEffectPadding("gradient", 12)).toBe(classic);
    expect(arrowEffectPadding("marker", 12)).toBeGreaterThan(classic);
    expect(arrowEffectPadding("crayon", 12)).toBeGreaterThan(arrowEffectPadding("marker", 12));
    for (const effect of EFFECTS) {
      expect(arrowEffectPadding(effect, 12)).toBeLessThan(12);
      expect(arrowEffectPadding(effect, 0)).toBeGreaterThan(0);
    }
  });

  it("composites the marker preset with one uniform alpha", () => {
    expect(arrowEffectOpacity("marker")).toBeGreaterThan(0);
    expect(arrowEffectOpacity("marker")).toBeLessThan(1);
    for (const effect of ["classic", "crayon", "gradient"] as ArrowEffect[])
      expect(arrowEffectOpacity(effect)).toBe(1);
    expect(arrowEffectOpacity(undefined)).toBe(1);
  });

  it("runs the default gradient from the arrow tail to its tip", () => {
    const shape = geometry("straight");
    const material = createArrowMaterial(shape, {
      width: shape.width,
      scale: 1,
      seed: 3,
      color: "#ee5533",
      effect: "gradient",
    });
    const fill = createArrowFill(fakeContext(), material) as unknown as FakeGradient;
    expect(fill.coords).toEqual([0, 0, 240, 0]);
    expect(fill.stops.map(([offset]) => offset)).toEqual([0, 0.55, 1]);
    expect(fill.stops[1][1]).toBe("#ee5533");
  });

  it("leaves the solid presets on the picked colour", () => {
    const shape = geometry("straight");
    for (const effect of ["classic", "crayon", "marker"] as ArrowEffect[]) {
      const material = createArrowMaterial(shape, {
        width: shape.width,
        scale: 1,
        seed: 3,
        color: "#ee5533",
        effect,
      });
      expect(createArrowFill(fakeContext(), material)).toBe("#ee5533");
    }
  });

  it.each(EFFECTS)("reuses the colour editor gradient stops for %s", (effect) => {
    const shape = geometry("straight");
    const material = createArrowMaterial(shape, {
      width: shape.width,
      scale: 1,
      seed: 3,
      color: "#ee5533",
      effect,
      gradientStops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
    });
    const fill = createArrowFill(fakeContext(), material) as unknown as FakeGradient;
    expect(fill.stops).toEqual([
      [0, "#ff0000"],
      [1, "#0000ff"],
    ]);
  });

  it("uses adjacent hues for colors and visible tonal gradients for black and white", () => {
    expect(arrowColorVariants("#f00").base).toEqual([255, 0, 0]);
    expect(arrowColorVariants("#ff0000").end).toContain("hsl(50");
    expect(arrowColorVariants("#000000").end).toBe("rgb(115, 115, 115)");
    expect(arrowColorVariants("#ffffff").end).toBe("rgb(166, 166, 166)");
    expect(arrowColorVariants("#ee5533").side[0]).toBeLessThan(238);
  });

  it.each(EFFECTS)("keeps the complete %s appearance inside resized bounds", (arrowEffect) => {
    const item = { ...arrow, style: { ...arrow.style, arrowEffect } };
    const before = annotationBounds(item);
    const target = { ...before, width: before.width * 0.65, height: before.height * 0.65 };
    const resized = resizeAnnotation(item, target);
    const bounds = annotationBounds(resized);
    expect(resized.style.arrowEffect).toBe(arrowEffect);
    expect(resized.style.strokeWidth).toBeLessThan(arrow.style.strokeWidth);
    expect(bounds.x).toBeCloseTo(target.x);
    expect(bounds.y).toBeCloseTo(target.y);
    expect(bounds.width).toBeLessThanOrEqual(target.width + 1e-8);
    expect(bounds.height).toBeLessThanOrEqual(target.height + 1e-8);
  });

  it("restores the shape and the material together on undo and redo", () => {
    const transaction = new ObjectMutationTransaction<RasterAnnotation[]>();
    const undo = new BoundedHistory<RasterAnnotation[]>(10);
    const redo = new BoundedHistory<RasterAnnotation[]>(10);
    let scene = cloneRasterAnnotations([arrow]);
    transaction.begin(cloneRasterAnnotations(scene));
    scene = scene.map((item) => ({
      ...item,
      style: { ...item.style, arrowEffect: "marker" as ArrowEffect, arrowStyle: "lightning" },
    }));
    undo.push(transaction.commit(true)!);
    redo.push(cloneRasterAnnotations(scene));
    scene = undo.pop()!;
    expect(scene[0].style.arrowEffect ?? DEFAULT_ARROW_EFFECT).toBe("classic");
    expect(scene[0].style.arrowStyle).toBe("straight");
    scene = redo.pop()!;
    expect(scene[0].style.arrowEffect).toBe("marker");
    expect(scene[0].style.arrowStyle).toBe("lightning");
    expect(arrow.style.arrowEffect).toBeUndefined();
  });
});
