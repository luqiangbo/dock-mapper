import { useCallback, useRef, useState, type RefObject } from "react";

export class BoundedHistory<T> {
  private values: T[] = [];

  constructor(private readonly limit: number) {}

  push(value: T): void {
    this.values.push(value);
    if (this.values.length > this.limit) this.values.shift();
  }

  pop(): T | undefined {
    return this.values.pop();
  }

  peek(): T | undefined {
    return this.values[this.values.length - 1];
  }

  clear(): void {
    this.values = [];
  }

  get canUndo(): boolean {
    return this.values.length > 0;
  }
}

export type EditorHistoryEntry<TObjects> =
  | { kind: "raster"; pixels: ImageData }
  | { kind: "objects"; objects: TObjects };

export class ObjectMutationTransaction<T> {
  private snapshot: T | null = null;

  begin(snapshot: T): void {
    if (this.snapshot === null) this.snapshot = snapshot;
  }

  commit(changed: boolean): T | undefined {
    const snapshot = this.snapshot;
    this.snapshot = null;
    return changed && snapshot !== null ? snapshot : undefined;
  }

  cancel(): void {
    this.snapshot = null;
  }

  get active(): boolean {
    return this.snapshot !== null;
  }
}

export function useEditorHistory<TObjects>(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  restoreObjects: (objects: TObjects) => void,
  limit = 30,
) {
  const snapshots = useRef(new BoundedHistory<EditorHistoryEntry<TObjects>>(limit));
  const restoreObjectsRef = useRef(restoreObjects);
  restoreObjectsRef.current = restoreObjects;
  const [canUndo, setCanUndo] = useState(false);

  const pushRaster = useCallback((pixels: ImageData) => {
    snapshots.current.push({ kind: "raster", pixels });
    setCanUndo(true);
  }, []);

  const pushObjects = useCallback((objects: TObjects) => {
    snapshots.current.push({ kind: "objects", objects });
    setCanUndo(true);
  }, []);

  const undo = useCallback(() => {
    const entry = snapshots.current.pop();
    if (!entry) return;
    if (entry.kind === "raster") {
      canvasRef.current?.getContext("2d")?.putImageData(entry.pixels, 0, 0);
    } else {
      restoreObjectsRef.current(entry.objects);
    }
    setCanUndo(snapshots.current.canUndo);
  }, [canvasRef]);

  const reset = useCallback(() => {
    snapshots.current.clear();
    setCanUndo(false);
  }, []);

  return { canUndo, pushRaster, pushObjects, undo, reset };
}
