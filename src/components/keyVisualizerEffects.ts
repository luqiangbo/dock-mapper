import type { KeyVisualizerEffectsStatus, KeyVisualizerMouse, KeyVisualizerScreen } from "../types";

export function acceptsKeyVisualizerEffect(
  status: KeyVisualizerEffectsStatus | null,
  generation: number,
): boolean {
  return !!status?.enabled && !status.suspended && status.generation === generation;
}

export function localMousePoint(screen: KeyVisualizerScreen, point: { x: number; y: number }) {
  return { x: (point.x - screen.x) / screen.scale, y: (point.y - screen.y) / screen.scale };
}

export function activeMouseEffects(
  effects: KeyVisualizerMouse[],
  now: number,
): KeyVisualizerMouse[] {
  return effects.filter(
    (effect) => now - effect.timestamp_ms < (effect.kind === "locate" ? 1000 : 600),
  );
}
