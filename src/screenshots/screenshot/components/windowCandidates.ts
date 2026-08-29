import type { WindowCandidate } from "../api";

export function findWindowCandidate(
  candidates: WindowCandidate[],
  x: number,
  y: number,
): WindowCandidate | undefined {
  return candidates
    .filter(
      (item) =>
        x >= item.x &&
        x <= item.x + item.width &&
        y >= item.y &&
        y <= item.y + item.height,
    )
    .sort((left, right) => left.zIndex - right.zIndex)[0];
}
