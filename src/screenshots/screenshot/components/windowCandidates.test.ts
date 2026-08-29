import { describe, expect, it } from "vitest";
import type { WindowCandidate } from "../api";
import { findWindowCandidate } from "./windowCandidates";

describe("window candidate selection", () => {
  it("selects the topmost overlapping window by z-order", () => {
    const candidates: WindowCandidate[] = [
      { id: "back", x: 0, y: 0, width: 300, height: 200, zIndex: 2 },
      { id: "front", x: 50, y: 50, width: 100, height: 100, zIndex: 0 },
    ];
    expect(findWindowCandidate(candidates, 75, 75)?.id).toBe("front");
    expect(findWindowCandidate(candidates, -1, -1)).toBeUndefined();
  });
});
