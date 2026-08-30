import type { WindowCandidate } from "../api";

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
