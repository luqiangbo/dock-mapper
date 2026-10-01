import { mosaicBounds, type MosaicPoint } from "./mosaicPatch";

/** A drag belongs to one pointer and one capture/viewport transform. */
export class MosaicDrag {
  private active: { id: number; key: string; start: MosaicPoint; end: MosaicPoint } | null = null;

  begin(id: number, point: MosaicPoint, key: string): boolean {
    if (this.active) return false;
    this.active = { id, key, start: point, end: point };
    return true;
  }
  owns(id: number): boolean {
    return this.active?.id === id;
  }
  move(id: number, point: MosaicPoint, key: string): boolean {
    if (!this.active || this.active.id !== id) return false;
    if (this.active.key !== key) {
      this.cancel();
      return false;
    }
    this.active.end = point;
    return true;
  }
  bounds(width: number, height: number, key: string) {
    if (!this.active) return null;
    if (this.active.key !== key) {
      this.cancel();
      return null;
    }
    return mosaicBounds(this.active.start, this.active.end, width, height);
  }
  finish(id: number, point: MosaicPoint, key: string, width: number, height: number) {
    if (!this.move(id, point, key)) return null;
    const rect = this.bounds(width, height, key);
    this.cancel();
    return rect && rect.width >= 2 && rect.height >= 2 ? rect : null;
  }
  cancel() {
    this.active = null;
  }
}
