import { describe, expect, it } from "vitest";
import {
  appendGesturePoint,
  createAnnotationGesture,
  resolveAnnotationGesture,
  shouldHandlePointer,
} from "./annotationGesture";

describe("annotation pointer gesture", () => {
  it("tracks the owning pointer and becomes changed after movement", () => {
    const gesture = createAnnotationGesture(7, "mosaic", { x: 10, y: 20 }, "baseline");
    expect(gesture.changed).toBe(false);
    expect(shouldHandlePointer(gesture, 8)).toBe(false);
    appendGesturePoint(gesture, { x: 30, y: 40 });
    expect(gesture.changed).toBe(true);
    expect(gesture.points).toHaveLength(2);
    expect(resolveAnnotationGesture(gesture, false)).toEqual({ commit: true, restore: false });
    expect(resolveAnnotationGesture(gesture, true)).toEqual({ commit: false, restore: true });
  });

  it("treats a pen press as a visible dot", () => {
    expect(createAnnotationGesture(1, "pen", { x: 1, y: 2 }, null).changed).toBe(true);
  });
});
