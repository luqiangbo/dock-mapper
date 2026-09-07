import { describe, expect, it } from "vitest";
import {
  acceptsKeyVisualizerEffect,
  activeMouseEffects,
  localMousePoint,
} from "./keyVisualizerEffects";
import type { KeyVisualizerEffectsStatus, KeyVisualizerMouse } from "../types";

describe("key visualizer effects", () => {
  it("places the pointer correctly on a negative-origin high-DPI monitor", () => {
    expect(
      localMousePoint(
        {
          label: "key-visualizer-effect-1",
          x: -2560,
          y: -200,
          width: 2560,
          height: 1440,
          scale: 1.5,
        },
        { x: -2410, y: -50 },
      ),
    ).toEqual({ x: 100, y: 100 });
  });
  it("removes clicks after 600ms while keeping a one-second locator", () => {
    const click: KeyVisualizerMouse = {
      generation: 1,
      x: 0,
      y: 0,
      kind: "left",
      timestamp_ms: 100,
    };
    const locate: KeyVisualizerMouse = { ...click, kind: "locate" };
    expect(activeMouseEffects([click, locate], 700)).toEqual([locate]);
    expect(activeMouseEffects([locate], 1100)).toEqual([]);
  });
  it("rejects events from a previous, stopped, or screenshot-suspended session", () => {
    const state = {
      enabled: true,
      suspended: false,
      generation: 2,
    } as KeyVisualizerEffectsStatus;
    expect(acceptsKeyVisualizerEffect(state, 1)).toBe(false);
    expect(acceptsKeyVisualizerEffect(state, 2)).toBe(true);
    expect(acceptsKeyVisualizerEffect({ ...state, enabled: false }, 2)).toBe(false);
    expect(acceptsKeyVisualizerEffect({ ...state, suspended: true }, 2)).toBe(false);
  });
});
