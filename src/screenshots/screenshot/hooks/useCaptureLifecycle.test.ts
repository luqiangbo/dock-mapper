import { describe, expect, it } from "vitest";
import {
  captureLifecycleReducer,
  INITIAL_CAPTURE_LIFECYCLE,
  type CapturePhase,
} from "./useCaptureLifecycle";

describe("capture lifecycle", () => {
  it("keeps every supported phase explicit", () => {
    const phases: CapturePhase[] = ["idle", "capturing", "selecting", "editing", "committing"];
    expect(phases).toHaveLength(5);
  });

  it("restores the editor after a failed commit and resets after cancellation", () => {
    const committing = captureLifecycleReducer(INITIAL_CAPTURE_LIFECYCLE, {
      type: "committing-started",
    });
    expect(committing).toMatchObject({ phase: "committing", busy: true });
    const recovered = captureLifecycleReducer(committing, {
      type: "failed",
      message: "保存失败",
      phase: "editing",
    });
    expect(recovered).toMatchObject({ phase: "editing", busy: false, error: "保存失败" });
    expect(captureLifecycleReducer(recovered, { type: "reset" })).toEqual(
      INITIAL_CAPTURE_LIFECYCLE,
    );
  });

  it("keeps the selection inside the same session reducer", () => {
    const selection = { x: 12, y: 24, width: 320, height: 180 };
    const selected = captureLifecycleReducer(INITIAL_CAPTURE_LIFECYCLE, {
      type: "selection",
      value: selection,
    });
    expect(selected.selection).toEqual(selection);
    expect(captureLifecycleReducer(selected, { type: "reset" }).selection).toBeNull();
  });
});
