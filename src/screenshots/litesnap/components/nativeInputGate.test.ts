import { describe, expect, it } from "vitest";
import { NativeInputGate } from "./nativeInputGate";

describe("native screenshot input gate", () => {
  it("owns one mouse gesture until it is released", () => {
    const gate = new NativeInputGate();
    expect(gate.beginMouse(100)).toEqual({ source: "mouse", id: -1 });
    expect(gate.beginMouse(110)).toBeNull();
    expect(gate.owns("mouse", -1)).toBe(true);
    gate.release("mouse", -1);
    expect(gate.beginMouse(120)).not.toBeNull();
  });

  it("ignores pointerType mouse and compatibility mouse events after pen input", () => {
    const gate = new NativeInputGate(500);
    expect(gate.beginPointer(4, "mouse", 100)).toBeNull();
    expect(gate.beginPointer(7, "pen", 200)).toEqual({ source: "pointer", id: 7 });
    gate.release("pointer", 7);
    expect(gate.beginMouse(400)).toBeNull();
    expect(gate.beginMouse(701)).not.toBeNull();
  });
});
