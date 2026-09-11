import { describe, expect, it } from "vitest";
import { ARROW_STYLE_OPTIONS, type ArrowStyle } from "./annotationTypes";
import {
  ARROW_BRUSH_PRESETS,
  DEFAULT_ARROW_BRUSH_ID,
  createArrowBrushStylePatch,
  normalizeArrowBrushId,
  type ArrowBrushId,
} from "./arrowBrushPresets";
import {
  arrowBrushColorVariants,
  arrowBrushOpacity,
  arrowBrushPadding,
  createArrowBrushFill,
  createArrowBrushMaterial,
} from "./arrowBrushRenderer";
import { calculateArrowGeometry } from "./arrowShapes";
import { arrowRenderCacheKey } from "./arrowGeometry";
import {
  annotationBounds,
  annotationGeometryBounds,
  cloneRasterAnnotations,
  resizeAnnotation,
  type RasterAnnotation,
} from "./annotationScene";
import { BoundedHistory, ObjectMutationTransaction } from "../hooks/useCanvasHistory";

const BRUSHES = ARROW_BRUSH_PRESETS.map(({ id }) => id);
const SHAPES = ARROW_STYLE_OPTIONS.map(({ value }) => value);

const arrow: RasterAnnotation = {
  id: "brush-arrow",
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
    arrowBrushId: "solid",
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

describe("arrow brush presets", () => {
  it("offers nine visually distinct brushes across seven rendering families", () => {
    expect(DEFAULT_ARROW_BRUSH_ID).toBe("solid");
    expect(ARROW_BRUSH_PRESETS).toHaveLength(9);
    expect(new Set(ARROW_BRUSH_PRESETS.map(({ id }) => id)).size).toBe(9);
    expect(new Set(ARROW_BRUSH_PRESETS.map(({ family }) => family))).toEqual(
      new Set(["solid", "marker", "bristle", "grain", "wet", "scatter", "pattern"]),
    );
    expect(ARROW_BRUSH_PRESETS.find(({ id }) => id === "solid")).toMatchObject({ size: 7, opacity: 1 });
    expect(ARROW_BRUSH_PRESETS.find(({ id }) => id === "marker")).toMatchObject({ size: 10, opacity: 0.68 });
    expect(ARROW_BRUSH_PRESETS.find(({ id }) => id === "charcoal")).toMatchObject({ size: 9, opacity: 0.78 });
    expect(ARROW_BRUSH_PRESETS.find(({ id }) => id === "watercolor")).toMatchObject({ size: 11, opacity: 0.68 });
    expect(ARROW_BRUSH_PRESETS.every(({ size }) => size >= 6 && size <= 11)).toBe(true);
  });

  it("gives every brush a distinct deterministic material signature", () => {
    const fingerprints = ARROW_BRUSH_PRESETS.map(
      ({ family, size, opacity, bleed, texture, spacing }) =>
        `${family}:${size}:${opacity}:${bleed}:${texture}:${spacing}`,
    );
    expect(new Set(fingerprints).size).toBe(9);
  });

  it("maps old effects and invalid values to readable brush presets", () => {
    expect(normalizeArrowBrushId(undefined, "classic")).toBe("solid");
    expect(normalizeArrowBrushId(undefined, "gradient")).toBe("solid");
    expect(normalizeArrowBrushId(undefined, "marker")).toBe("marker");
    expect(normalizeArrowBrushId(undefined, "crayon")).toBe("charcoal");
    expect(normalizeArrowBrushId("airbrush")).toBe("spray");
    expect(normalizeArrowBrushId("invalid")).toBe("solid");
  });

  it("applies brush material and logical size as one style patch", () => {
    expect(createArrowBrushStylePatch("watercolor", 1.5)).toEqual({
      arrowBrushId: "watercolor",
      strokeWidth: 16.5,
    });
  });
});

describe("arrow brush renderer", () => {
  it.each(BRUSHES)("%s textures the geometry silhouette without replacing it", (brushId) => {
    for (const style of SHAPES) {
      const shape = geometry(style);
      const material = createArrowBrushMaterial(shape, {
        width: shape.width,
        scale: 1,
        seed: 91,
        color: "#ee5533",
        brushId,
      });
      expect(material.brushId).toBe(brushId);
      expect(material.outline).toBe(shape.contours);
      expect(material.strokes[0].points).toBe(shape.contours[0]);
      expect(material.strokes[0].closed).toBe(true);
    }
  });

  it.each(BRUSHES)("keeps arrow geometry identical when switching to %s", (arrowBrushId) => {
    expect(annotationGeometryBounds({ ...arrow, style: { ...arrow.style, arrowBrushId } })).toEqual(
      annotationGeometryBounds(arrow),
    );
  });

  it("allocates cache padding for each brush's measured scatter radius", () => {
    expect(arrowBrushPadding("solid", 12)).toBe(0);
    expect(arrowBrushPadding("brush-pen", 12)).toBeGreaterThanOrEqual(9);
    expect(arrowBrushPadding("pencil", 12)).toBeGreaterThanOrEqual(12);
    expect(arrowBrushPadding("charcoal", 12)).toBeGreaterThanOrEqual(19);
    expect(arrowBrushPadding("watercolor", 12)).toBeGreaterThanOrEqual(7);
    expect(arrowBrushPadding("spray", 12)).toBeGreaterThanOrEqual(16);
    expect(BRUSHES.filter((brushId) => brushId !== "solid").every((brushId) => arrowBrushPadding(brushId, 12) > 0)).toBe(true);
  });

  it("uses one preset-level opacity for the complete composited arrow", () => {
    expect(arrowBrushOpacity("solid")).toBe(1);
    expect(arrowBrushOpacity("charcoal")).toBe(0.78);
    expect(arrowBrushOpacity("marker")).toBe(0.68);
    expect(arrowBrushOpacity("watercolor")).toBe(0.68);
  });

  it.each(BRUSHES)("keeps %s on the picked color without explicit gradient stops", (brushId) => {
    const shape = geometry();
    const material = createArrowBrushMaterial(shape, {
      width: shape.width,
      scale: 1,
      seed: 3,
      color: "#ee5533",
      brushId,
    });
    expect(createArrowBrushFill(fakeContext(), material)).toBe("#ee5533");
  });

  it.each(BRUSHES)("reuses the color editor gradient for %s", (brushId) => {
    const material = createArrowBrushMaterial(geometry(), {
      width: 12,
      scale: 1,
      seed: 3,
      color: "#ee5533",
      brushId,
      gradientStops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
    });
    const fill = createArrowBrushFill(fakeContext(), material) as unknown as FakeGradient;
    expect(fill.coords).toEqual([0, 0, 240, 0]);
    expect(fill.stops).toEqual([
      [0, "#ff0000"],
      [1, "#0000ff"],
    ]);
  });

  it("provides stable tonal variants for procedural texture passes", () => {
    const variants = arrowBrushColorVariants("#ee5533");
    expect(variants.base).toEqual([238, 85, 51]);
    expect(variants.dark[0]).toBeLessThan(variants.base[0]);
    expect(variants.light[0]).toBeGreaterThan(variants.base[0]);
  });

  it("invalidates the bitmap cache when its brush preset changes", () => {
    const request = {
      length: 240,
      lineWidth: 12,
      canvasScale: 1,
      style: "straight" as const,
      color: "#ee5533",
    };
    expect(arrowRenderCacheKey({ ...request, brushId: "solid" })).not.toBe(
      arrowRenderCacheKey({ ...request, brushId: "watercolor" }),
    );
  });

  it.each(BRUSHES)("keeps the complete %s appearance inside resized bounds", (arrowBrushId) => {
    const item = { ...arrow, style: { ...arrow.style, arrowBrushId } };
    const before = annotationBounds(item);
    const target = { ...before, width: before.width * 0.65, height: before.height * 0.65 };
    const resized = resizeAnnotation(item, target);
    const bounds = annotationBounds(resized);
    expect(resized.style.arrowBrushId).toBe(arrowBrushId);
    expect(resized.style.strokeWidth).toBeLessThan(arrow.style.strokeWidth);
    expect(bounds.x).toBeCloseTo(target.x);
    expect(bounds.y).toBeCloseTo(target.y);
    expect(bounds.width).toBeLessThanOrEqual(target.width + 1e-8);
    expect(bounds.height).toBeLessThanOrEqual(target.height + 1e-8);
  });

  it("restores brush and preset size together on undo and redo", () => {
    const transaction = new ObjectMutationTransaction<RasterAnnotation[]>();
    const undo = new BoundedHistory<RasterAnnotation[]>(10);
    const redo = new BoundedHistory<RasterAnnotation[]>(10);
    let scene = cloneRasterAnnotations([arrow]);
    transaction.begin(cloneRasterAnnotations(scene));
    const patch = createArrowBrushStylePatch("watercolor", 1);
    scene = scene.map((item) => ({ ...item, style: { ...item.style, ...patch } }));
    undo.push(transaction.commit(true)!);
    redo.push(cloneRasterAnnotations(scene));
    scene = undo.pop()!;
    expect(scene[0].style.arrowBrushId).toBe("solid");
    expect(scene[0].style.strokeWidth).toBe(12);
    scene = redo.pop()!;
    expect(scene[0].style.arrowBrushId).toBe("watercolor");
    expect(scene[0].style.strokeWidth).toBe(11);
  });
});
