import { describe, expect, it } from "vitest";
import {
  acceptsPresentationEvent,
  activeMouseEffects,
  localMousePoint,
} from "./presentationEffects";
import type { PresentationMouse, PresentationStatus } from "../types";

describe("presentation effects", () => {
  it("places the pointer correctly on a negative-origin high-DPI monitor", () => {
    expect(
      localMousePoint(
        { label: "presentation-1", x: -2560, y: -200, width: 2560, height: 1440, scale: 1.5 },
        { x: -2410, y: -50 },
      ),
    ).toEqual({ x: 100, y: 100 });
  });
  it("removes clicks after 600ms while keeping a one-second locator", () => {
    const click: PresentationMouse = { generation: 1, x: 0, y: 0, kind: "left", timestamp_ms: 100 };
    const locate: PresentationMouse = { ...click, kind: "locate" };
    expect(activeMouseEffects([click, locate], 700)).toEqual([locate]);
    expect(activeMouseEffects([locate], 1100)).toEqual([]);
  });
  it("rejects events from a previous, stopped, or screenshot-suspended session", () => {
    const state = { enabled: true, suspended: false, generation: 2 } as PresentationStatus;
    expect(acceptsPresentationEvent(state, 1)).toBe(false);
    expect(acceptsPresentationEvent(state, 2)).toBe(true);
    expect(acceptsPresentationEvent({ ...state, enabled: false }, 2)).toBe(false);
    expect(acceptsPresentationEvent({ ...state, suspended: true }, 2)).toBe(false);
  });
});
