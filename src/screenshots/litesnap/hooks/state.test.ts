import { describe, expect, it } from "vitest";
import {
  BoundedHistory,
  ObjectMutationTransaction,
} from "./useCanvasHistory";
import { RequestGeneration } from "./requestGeneration";

describe("editor state helpers", () => {
  it("invalidates an older OCR result after cancel or a newer request", () => {
    const requests = new RequestGeneration();
    const first = requests.next();
    const second = requests.next();
    expect(requests.isCurrent(first)).toBe(false);
    expect(requests.isCurrent(second)).toBe(true);
    requests.cancel();
    expect(requests.isCurrent(second)).toBe(false);
  });

  it("keeps undo history bounded and restores the newest snapshot first", () => {
    const history = new BoundedHistory<number>(2);
    history.push(1);
    history.push(2);
    history.push(3);
    expect(history.pop()).toBe(3);
    expect(history.pop()).toBe(2);
    expect(history.canUndo).toBe(false);
  });

  it("keeps complete scene snapshots in chronological order", () => {
    const history = new BoundedHistory<{ raster: string[]; objects: string[] }>(3);
    history.push({ raster: ["arrow"], objects: [] });
    history.push({ raster: ["arrow"], objects: ["number"] });
    expect(history.pop()).toEqual({ raster: ["arrow"], objects: ["number"] });
    expect(history.pop()).toEqual({ raster: ["arrow"], objects: [] });
  });

  it("coalesces a continuous object interaction and ignores empty interactions", () => {
    const transaction = new ObjectMutationTransaction<string>();
    transaction.begin("before-color-picker");
    transaction.begin("ignored-second-snapshot");
    expect(transaction.commit(true)).toBe("before-color-picker");
    transaction.begin("before-empty-click");
    expect(transaction.commit(false)).toBeUndefined();
    expect(transaction.active).toBe(false);
  });
});
