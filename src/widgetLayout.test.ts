import { describe, expect, it } from "vitest";
import { calculateWidgetResponsiveLayout } from "./widgetLayout";

describe("taskbar widget responsive layout", () => {
  const normal = [112, 48, 32, 48];
  const compact = [88, 42, 30, 42];

  it("keeps every metric at normal spacing when the safe slot is wide enough", () => {
    expect(calculateWidgetResponsiveLayout(normal, compact, 270)).toEqual({
      compact: false,
      visibleCount: 4,
      hiddenCount: 0,
      showOverflow: false,
    });
  });

  it("tightens spacing before hiding configured metrics", () => {
    expect(calculateWidgetResponsiveLayout(normal, compact, 220)).toEqual({
      compact: true,
      visibleCount: 4,
      hiddenCount: 0,
      showOverflow: false,
    });
  });

  it("hides metrics from the end and reserves an overflow marker", () => {
    expect(calculateWidgetResponsiveLayout(normal, compact, 155)).toEqual({
      compact: true,
      visibleCount: 2,
      hiddenCount: 2,
      showOverflow: true,
    });
  });

  it("keeps the first configured metric when only its minimum fits", () => {
    expect(calculateWidgetResponsiveLayout(normal, compact, 92)).toEqual({
      compact: true,
      visibleCount: 1,
      hiddenCount: 3,
      showOverflow: false,
    });
  });
});
