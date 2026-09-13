export interface CanvasCacheValue {
  canvas: HTMLCanvasElement;
}

/** Small LRU cache bounded by both entry count and retained canvas pixels. */
export class CanvasRenderCache<Key, Value extends CanvasCacheValue> {
  private readonly values = new Map<Key, Value>();
  private pixels = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxPixels: number,
  ) {}

  get(key: Key): Value | undefined {
    const value = this.values.get(key);
    if (!value) return undefined;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key: Key, value: Value): void {
    this.delete(key);
    this.values.set(key, value);
    this.pixels += CanvasRenderCache.pixelCount(value);
    while (
      this.values.size > this.maxEntries ||
      (this.values.size > 1 && this.pixels > this.maxPixels)
    ) {
      const oldest = this.values.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }

  delete(key: Key): void {
    const value = this.values.get(key);
    if (value) this.pixels -= CanvasRenderCache.pixelCount(value);
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
    this.pixels = 0;
  }

  private static pixelCount(value: CanvasCacheValue): number {
    return value.canvas.width * value.canvas.height;
  }
}
