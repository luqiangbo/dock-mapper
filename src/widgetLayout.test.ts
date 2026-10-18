import { describe, expect, it } from "vitest";
import { calculateWidgetResponsiveLayout, describeWidgetLayout } from "./widgetLayout";
import {
  DEFAULT_WIDGET_LAYOUT,
  acceptWidgetBudget,
  enabledWidgetMetrics,
  widgetSpacing,
} from "./widgetPresentation";
import type { WidgetLayoutBudget } from "./api/screenshotTypes";

describe("taskbar widget responsive layout", () => {
  const normal = [112, 48, 32, 48];
  const compact = [88, 42, 30, 42];

  it("keeps an enabled CPU metric with available sampling data", () => {
    const metrics = enabledWidgetMetrics(
      [
        {
          kind: "cpu",
          enabled: true,
          usage_scheme: "number",
          icon_style: "text",
          row_layout: "single",
        },
      ],
      { cpu_usage: 20, battery: null },
    );
    expect(metrics.map((m) => m.kind)).toEqual(["cpu"]);
    expect(DEFAULT_WIDGET_LAYOUT.font_size).toBe(14);
    expect(DEFAULT_WIDGET_LAYOUT.icon_size).toBe(18);
  });

  it("keeps standard dimensions and custom spacing when standard mode is locked", () => {
    const settings = {
      ...DEFAULT_WIDGET_LAYOUT,
      mode: "standard" as const,
      metric_gap: 10,
      horizontal_padding: 8,
    };
    const layout = calculateWidgetResponsiveLayout(normal, compact, 220, 12, settings);
    expect(layout.compact).toBe(false);
    expect(layout.visibleCount).toBe(2);
    expect(layout.showOverflow).toBe(true);
  });

  it("keeps compact dimensions and full custom spacing when compact mode is locked", () => {
    const settings = { ...DEFAULT_WIDGET_LAYOUT, mode: "compact" as const };
    expect(calculateWidgetResponsiveLayout(normal, compact, 300, 12, settings).compact).toBe(true);
    expect(widgetSpacing(settings, true)).toEqual({ gap: 6, padding: 4 });
    expect(widgetSpacing(DEFAULT_WIDGET_LAYOUT, true)).toEqual({ gap: 3, padding: 2 });
  });

  it("does not hide the last metric when rounded row width includes all fractional item widths", () => {
    expect(
      calculateWidgetResponsiveLayout([41.2, 41.2, 41.2], [35.4, 35.4, 35.4], 144).visibleCount,
    ).toBe(3);
    expect(
      calculateWidgetResponsiveLayout([41.2, 41.2, 41.2], [35.4, 35.4, 35.4], 144).compact,
    ).toBe(false);
  });

  it("zero spacing can fit every metric without an overflow marker", () => {
    const settings = {
      ...DEFAULT_WIDGET_LAYOUT,
      mode: "standard" as const,
      metric_gap: 0,
      horizontal_padding: 0,
    };
    expect(calculateWidgetResponsiveLayout([40, 40], [30, 30], 80, 12, settings)).toEqual({
      compact: false,
      visibleCount: 2,
      hiddenCount: 0,
      showOverflow: false,
    });
  });

  it("an older IPC result cannot overwrite a newer native recovery snapshot", () => {
    const ready: WidgetLayoutBudget = {
      revision: 3,
      state: "ready",
      visible: true,
      allocatedWidth: 180,
      constrained: false,
      error: null,
    };
    const hidden: WidgetLayoutBudget = {
      ...ready,
      revision: 2,
      state: "insufficientSpace",
      visible: false,
      allocatedWidth: 0,
    };
    expect(acceptWidgetBudget(ready, hidden)).toBe(ready);
    expect(acceptWidgetBudget(hidden, ready)).toBe(ready);
  });

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

  it("reports exactly which configured indicators are hidden by taskbar space", () => {
    expect(
      describeWidgetLayout(
        ["network", "cpu", "memory"],
        {
          compact: true,
          visibleCount: 1,
          hiddenCount: 2,
          showOverflow: true,
        },
        true,
      ),
    ).toEqual({
      visibleKinds: ["network"],
      hiddenKinds: ["cpu", "memory"],
      compact: true,
      visible: true,
    });
  });
});
