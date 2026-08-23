export type NativeInputOwner = { source: "mouse"; id: -1 } | { source: "pointer"; id: number };

export class NativeInputGate {
  private owner: NativeInputOwner | null = null;
  private lastNonMousePointerAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly compatibilityMouseWindowMs = 500) {}

  beginMouse(now: number): NativeInputOwner | null {
    if (this.owner || now - this.lastNonMousePointerAt < this.compatibilityMouseWindowMs)
      return null;
    this.owner = { source: "mouse", id: -1 };
    return this.owner;
  }

  beginPointer(pointerId: number, pointerType: string, now: number): NativeInputOwner | null {
    if (pointerType === "mouse" || this.owner) return null;
    this.lastNonMousePointerAt = now;
    this.owner = { source: "pointer", id: pointerId };
    return this.owner;
  }

  owns(source: NativeInputOwner["source"], id: number): boolean {
    return this.owner?.source === source && this.owner.id === id;
  }

  current(): NativeInputOwner | null {
    return this.owner;
  }

  release(source: NativeInputOwner["source"], id: number): void {
    if (this.owns(source, id)) this.owner = null;
  }

  reset(): void {
    this.owner = null;
  }
}
