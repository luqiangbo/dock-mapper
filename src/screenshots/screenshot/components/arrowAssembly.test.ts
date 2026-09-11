import { describe, expect, it } from "vitest";
import {
  arrowAssemblyKey,
  arrowLineParts,
  createArrowAssemblyVariation,
} from "./arrowAssembly";
import { calculateArrowGeometry } from "./arrowShapes";
import { alphaContentBounds, arrowRenderCacheKey } from "./arrowGeometry";
import { cloneRasterAnnotations, resizeAnnotation, type RasterAnnotation } from "./annotationScene";

describe("assembled arrow", () => {
  it("reproduces its proportions from one seed without bending the center axis", () => {
    const first = createArrowAssemblyVariation("straight", "charcoal", 41);
    expect(createArrowAssemblyVariation("straight", "charcoal", 41)).toEqual(first);
    expect(createArrowAssemblyVariation("straight", "charcoal", 42)).not.toEqual(first);
    expect(arrowAssemblyKey(first)).toBe(arrowAssemblyKey({ ...first }));
    const geometry = calculateArrowGeometry({
      start: { x: 0, y: 0 },
      end: { x: 1200, y: 0 },
      lineWidth: 6,
      style: "straight",
      assembly: first,
    })!;
    expect(geometry.shaftPoints.every(({ y }) => y === 0)).toBe(true);
    expect(geometry.heads[0].tip).toEqual({ x: 1200, y: 0 });
  });

  it("builds single, segmented and double arrows from straight line parts", () => {
    const make = (style: "straight" | "segmented" | "double") =>
      arrowLineParts(
        calculateArrowGeometry({
          start: { x: 0, y: 0 },
          end: { x: 240, y: 0 },
          lineWidth: 8,
          style,
        })!,
      );
    expect(make("straight")).toHaveLength(3);
    expect(make("segmented").filter(({ role }) => role === "shaft")).toHaveLength(3);
    expect(make("double")).toHaveLength(5);
    expect(make("segmented").every(({ start, end }) => start.y === 0 || end.x === 240)).toBe(true);
  });

  it("includes frozen assembly proportions in the render cache identity", () => {
    const request = {
      length: 240,
      lineWidth: 8,
      canvasScale: 1,
      style: "straight" as const,
      color: "#222222",
      brushId: "pencil" as const,
    };
    expect(
      arrowRenderCacheKey({
        ...request,
        assembly: createArrowAssemblyVariation("straight", "pencil", 1),
      }),
    ).not.toBe(
      arrowRenderCacheKey({
        ...request,
        assembly: createArrowAssemblyVariation("straight", "pencil", 2),
      }),
    );
  });

  it("preserves assembly proportions through cloning and resizing", () => {
    const variation = createArrowAssemblyVariation("straight", "marker", 92);
    const arrow: RasterAnnotation = {
      id: "varied",
      kind: "arrow",
      points: [{ x: 20, y: 20 }, { x: 220, y: 80 }],
      style: {
        color: "#f00",
        strokeWidth: 10,
        fillOpacity: 0,
        arrowStyle: "straight",
        arrowBrushId: "marker",
        arrowAssembly: variation,
        arrowHeadSize: 1,
        opacity: 1,
        mosaicBlock: 12,
      },
    };
    const cloned = cloneRasterAnnotations([arrow])[0];
    const resized = resizeAnnotation(cloned, { x: 10, y: 10, width: 120, height: 60 });
    expect(cloned.style.arrowAssembly).toEqual(variation);
    expect(cloned.style.arrowAssembly).not.toBe(variation);
    expect(resized.style.arrowAssembly).toEqual(variation);
  });
});

describe("brush alpha cache bounds", () => {
  it("finds only non-transparent pixels and rejects an empty render", () => {
    const pixels = new Uint8ClampedArray(6 * 4 * 4);
    pixels[(1 * 6 + 2) * 4 + 3] = 10;
    pixels[(3 * 6 + 4) * 4 + 3] = 255;
    expect(alphaContentBounds(pixels, 6, 4)).toEqual({ x: 2, y: 1, width: 3, height: 3 });
    expect(alphaContentBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });
});
