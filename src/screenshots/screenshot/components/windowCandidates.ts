import type { WindowCandidate } from "../api";

export type WindowSelectionDragMode = "candidate" | "manual";

export function advanceWindowSelectionDragMode(
  mode: WindowSelectionDragMode,
  start: { x: number; y: number },
  current: { x: number; y: number },
  threshold = 3,
): WindowSelectionDragMode {
  if (mode === "manual") return "manual";
  return Math.hypot(current.x - start.x, current.y - start.y) > threshold
    ? "manual"
    : "candidate";
}

export function findWindowCandidate(
  candidates: WindowCandidate[],
  x: number,
  y: number,
): WindowCandidate | undefined {
  let topmost: WindowCandidate | undefined;
  for (const item of candidates) {
    if (
      x < item.x ||
      x > item.x + item.width ||
      y < item.y ||
      y > item.y + item.height
    )
      continue;
    if (!topmost || item.zIndex < topmost.zIndex) topmost = item;
  }
  return topmost;
}
