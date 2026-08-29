import { useCallback, useRef, useState } from "react";

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
  restoreObjects: (objects: TObjects) => void,
  limit = 30,
) {
  const past = useRef(new BoundedHistory<TObjects>(limit));
  const future = useRef(new BoundedHistory<TObjects>(limit));
  const restoreObjectsRef = useRef(restoreObjects);
  restoreObjectsRef.current = restoreObjects;
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pushObjects = useCallback((objects: TObjects) => {
    past.current.push(objects);
    future.current.clear();
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const undo = useCallback((current: TObjects) => {
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push(current);
    restoreObjectsRef.current(previous);
    setCanUndo(past.current.canUndo);
    setCanRedo(true);
  }, []);

  const redo = useCallback((current: TObjects) => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(current);
    restoreObjectsRef.current(next);
    setCanUndo(true);
    setCanRedo(future.current.canUndo);
  }, []);

  const reset = useCallback(() => {
    past.current.clear();
    future.current.clear();
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  return { canUndo, canRedo, pushObjects, undo, redo, reset };
}
