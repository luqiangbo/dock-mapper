import type { PresentationMouse, PresentationScreen, PresentationStatus } from "../types";

export function acceptsPresentationEvent(
  status: PresentationStatus | null,
  generation: number,
): boolean {
  return !!status?.enabled && !status.suspended && status.generation === generation;
}

export function localMousePoint(screen: PresentationScreen, point: { x: number; y: number }) {
  return { x: (point.x - screen.x) / screen.scale, y: (point.y - screen.y) / screen.scale };
}

export function activeMouseEffects(effects: PresentationMouse[], now: number): PresentationMouse[] {
  return effects.filter(
    (effect) => now - effect.timestamp_ms < (effect.kind === "locate" ? 1000 : 600),
  );
}
