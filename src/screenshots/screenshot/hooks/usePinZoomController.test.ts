import { describe, expect, it } from "vitest";
import { zoomGeometryAtAnchor } from "./usePinZoomController";

describe("pin zoom geometry", () => {
  it("keeps the screen pixel below the pointer fixed", () => {
    const next = zoomGeometryAtAnchor(
      400,
      200,
      2,
      { ratioX: 0.25, ratioY: 0.75, screenX: 300, screenY: 250 },
      9,
    );
    expect(next).toEqual({ x: 100, y: -50, width: 800, height: 400, scale: 2, sequence: 9 });
    expect(next.x + next.width * 0.25).toBe(300);
    expect(next.y + next.height * 0.75).toBe(250);
  });

  it("clamps the absolute scale instead of compounding without bounds", () => {
    expect(
      zoomGeometryAtAnchor(
        400,
        200,
        99,
        { ratioX: 0, ratioY: 0, screenX: 0, screenY: 0 },
        1,
      ).scale,
    ).toBe(4);
  });
});
