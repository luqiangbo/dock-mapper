import { describe, expect, it } from "vitest";
import {
  arrowVisualBounds,
  assembledArrowParts,
  styledLinePadding,
  roughDrawableCacheKey,
} from "./annotationLineRenderer";
import { annotationRoughOptions } from "./roughAnnotationStyle";
import { normalizeArrowStyle, normalizeLineStyle } from "./annotationTypes";

describe("semantic annotation lines", () => {
  it("normalizes removed effects and shapes to supported values", () => {
    expect(normalizeArrowStyle("lightning")).toBe("sharp");
    expect(normalizeLineStyle(undefined, "gradient")).toBe("solid");
    expect(normalizeLineStyle(undefined, "watercolor")).toBe("solid");
    expect(normalizeLineStyle(undefined, undefined, "hatch")).toBe("solid");
    expect(normalizeLineStyle()).toBe("solid");
  });

  it("keeps the shaft axis stable while seeds vary the open arrow head", () => {
    const first = assembledArrowParts({ x: 10, y: 20 }, { x: 210, y: 20 }, "straight", 1);
    const repeated = assembledArrowParts({ x: 10, y: 20 }, { x: 210, y: 20 }, "straight", 1);
    const varied = assembledArrowParts({ x: 10, y: 20 }, { x: 210, y: 20 }, "straight", 2);
    expect(first).toEqual(repeated);
    expect(first[0]).toEqual({ role: "shaft", start: { x: 10, y: 20 }, end: { x: 210, y: 20 } });
    expect(first.slice(1)).not.toEqual(varied.slice(1));
  });

  it("reserves extra paint bounds for an enabled outline", () => {
    expect(styledLinePadding(4, 2)).toBeGreaterThan(styledLinePadding(4, 0));
  });

  it("keeps line bounds deterministic across stroke presets", () => {
    const sticker = arrowVisualBounds(
      { x: 10, y: 20 },
      { x: 210, y: 20 },
      "straight",
      4,
      42,
      1,
      "solid",
    );
    const sketch = arrowVisualBounds(
      { x: 10, y: 20 },
      { x: 210, y: 20 },
      "straight",
      4,
      42,
      1,
      "dashed",
    );
    expect(sticker).toEqual(sketch);
  });

  it("uses stable Excalidraw-style RoughJS options and softens tiny shapes", () => {
    const first = annotationRoughOptions("solid", "#e03131", 1, 42, {
      width: 120,
      height: 40,
    });
    const repeated = annotationRoughOptions("solid", "#e03131", 1, 42, {
      width: 120,
      height: 40,
    });
    const tiny = annotationRoughOptions("solid", "#e03131", 1, 42, {
      width: 8,
      height: 8,
    });
    expect(first).toEqual(repeated);
    expect(tiny.roughness ?? Number.POSITIVE_INFINITY).toBeLessThan(first.roughness ?? 0);
  });

  it("invalidates cached drawables for every rendered style field", () => {
    const red = roughDrawableCacheKey("frame", ["rect", 1], { stroke: "#e03131", fill: "#ffc9c9", roughness: 1 });
    const blue = roughDrawableCacheKey("frame", ["rect", 1], { stroke: "#1971c2", fill: "#ffc9c9", roughness: 1 });
    const filled = roughDrawableCacheKey("frame", ["rect", 1], { stroke: "#e03131", fill: "#a5d8ff", roughness: 1 });
    expect(new Set([red, blue, filled])).toHaveLength(3);
  });
});
