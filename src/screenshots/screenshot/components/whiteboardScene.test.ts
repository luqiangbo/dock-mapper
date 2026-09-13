import { describe, expect, it } from "vitest";
import type { RasterAnnotation } from "./annotationScene";
import {
  bindingAtPoint,
  deleteSceneSelection,
  duplicateSceneSelection,
  groupElements,
  moveSceneLayer,
  resolveSceneBindings,
  rotateSceneSelection,
  sceneElement,
  selectionBounds,
  snapDelta,
  ungroupElements,
} from "./whiteboardScene";

const style: RasterAnnotation["style"] = {
  color: "#e03131",
  backgroundColor: "#ffc9c9",
  strokeWidth: 3,
  lineStyle: "solid",
  fillStyle: "none",
  roughness: 1,
  outline: { enabled: false, color: "#fff", width: 1 },
  arrowStyle: "sharp",
  startArrowhead: "none",
  endArrowhead: "arrow",
  opacity: 1,
  mosaicBlock: 12,
};

function raster(id: string, kind: RasterAnnotation["kind"], x: number): RasterAnnotation {
  return {
    id,
    kind,
    points: [{ x, y: 10 }, { x: x + 40, y: 50 }],
    style: { ...style },
    angle: 0,
    groupId: null,
    version: 1,
    seed: x + 1,
  };
}

describe("finite whiteboard scene transitions", () => {
  it("groups, ungroups and preserves stable z-order layer moves", () => {
    const scene = [sceneElement(raster("a", "rect", 0)), sceneElement(raster("b", "ellipse", 50)), sceneElement(raster("c", "diamond", 100))];
    const grouped = groupElements(scene, new Set(["a", "b"]), "g1");
    expect(grouped.slice(0, 2).map((item) => item.value.groupId)).toEqual(["g1", "g1"]);
    expect(moveSceneLayer(grouped, new Set(["a", "b"]), "front").map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(ungroupElements(grouped, new Set(["a"])).slice(0, 2).every((item) => !item.value.groupId)).toBe(true);
  });

  it("duplicates internal bindings and drops bindings to objects outside the copy", () => {
    const target = raster("target", "rect", 0);
    const arrow = raster("arrow", "arrow", 50);
    arrow.startBinding = { elementId: target.id, anchor: { x: 1, y: 0.5 } };
    const scene = [sceneElement(target), sceneElement(arrow)];
    const both = duplicateSceneSelection(scene, new Set(["target", "arrow"]), (id) => `${id}-copy`);
    const copiedArrow = both.elements.find((item) => item.id === "arrow-copy");
    expect(copiedArrow?.type === "raster" && copiedArrow.value.startBinding?.elementId).toBe("target-copy");
    const onlyArrow = duplicateSceneSelection(scene, new Set(["arrow"]), (id) => `${id}-solo`);
    const solo = onlyArrow.elements.find((item) => item.id === "arrow-solo");
    expect(solo?.type === "raster" && solo.value.startBinding).toBeNull();
  });

  it("updates bound endpoints and unbinds without moving endpoints when a target is deleted", () => {
    const target = raster("target", "rect", 0);
    const arrow = raster("arrow", "arrow", 80);
    arrow.startBinding = bindingAtPoint([sceneElement(target)], { x: 40, y: 30 }, arrow.id);
    const resolved = resolveSceneBindings([sceneElement(target), sceneElement(arrow)]);
    const before = resolved[1].type === "raster" ? resolved[1].value.points[0] : null;
    const remaining = deleteSceneSelection(resolved, new Set([target.id]));
    const after = remaining[0].type === "raster" ? remaining[0].value : null;
    expect(after?.startBinding).toBeNull();
    expect(after?.points[0]).toEqual(before);
  });

  it("computes rotated selection bounds and fixed-tolerance center snapping", () => {
    const scene = [sceneElement(raster("a", "rect", 0))];
    const bounds = selectionBounds(scene, new Set(["a"]))!;
    const rotated = rotateSceneSelection(scene, new Set(["a"]), { x: 20, y: 30 }, Math.PI / 2);
    expect(rotated[0].value.angle).toBeCloseTo(Math.PI / 2);
    expect(selectionBounds(rotated, new Set(["a"]))?.width).toBeGreaterThan(0);
    const snap = snapDelta({ x: 48, y: 48, width: 10, height: 10 }, [], { width: 106, height: 106 }, 6);
    expect(snap.guides.map((guide) => guide.axis).sort()).toEqual(["x", "y"]);
    expect(bounds.height).toBeGreaterThan(0);
  });
});
