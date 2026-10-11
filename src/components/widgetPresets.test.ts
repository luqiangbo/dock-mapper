import { describe, expect, it } from "vitest";
import type { WidgetConfig } from "../types";
import { DEFAULT_WIDGET_LAYOUT } from "../widgetPresentation";
import { applyWidgetPreset, deleteWidgetPreset, saveCurrentWidgetPreset } from "./widgetPresets";

const config: WidgetConfig = {
  layout: { ...DEFAULT_WIDGET_LAYOUT },
  memory_scheme: "capsule",
  metrics: [
    {
      kind: "upload",
      pair_with: "cpu",
      enabled: true,
      usage_scheme: "capsule",
      icon_style: "outline",
      row_layout: "single",
    },
    {
      kind: "cpu",
      pair_with: "upload",
      enabled: true,
      usage_scheme: "ring",
      icon_style: "outline",
      row_layout: "single",
    },
  ],
  refresh_interval_secs: 2,
  network_interface: null,
  speed_unit: "mb",
  alerts: { cpu_percent: 85, memory_percent: null, battery_below_percent: null },
  presets: [],
};

describe("挂件布局预设", () => {
  it("应用保存的布局时恢复指标顺序和采样选项，并保留提醒规则", () => {
    const saved = saveCurrentWidgetPreset(config, "办公");
    const changed = {
      ...saved,
      metrics: [...saved.metrics].reverse(),
      refresh_interval_secs: 5,
      speed_unit: "auto" as const,
    };
    const applied = applyWidgetPreset(changed, "办公");
    expect(applied?.metrics.map((item) => item.kind)).toEqual(["upload", "cpu"]);
    expect(applied?.metrics.map((item) => item.pair_with)).toEqual(["cpu", "upload"]);
    expect(applied?.refresh_interval_secs).toBe(2);
    expect(applied?.speed_unit).toBe("mb");
    expect(applied?.alerts.cpu_percent).toBe(85);
  });

  it("删除预设后重新进入时列表不再包含它", () => {
    const saved = saveCurrentWidgetPreset(config, "办公");
    expect(deleteWidgetPreset(saved, "办公").presets).toEqual([]);
  });

  it("预设恢复距离和图标样式，修改当前设置不会改变已经保存的预设", () => {
    const styled: WidgetConfig = {
      ...config,
      layout: { ...config.layout, metric_gap: 17, mode: "compact" },
      metrics: config.metrics.map((metric) => ({
        ...metric,
        icon_style: "text",
        row_layout: "single",
      })),
    };
    const saved = saveCurrentWidgetPreset(styled, "距离");
    const changed = {
      ...saved,
      layout: { ...saved.layout, metric_gap: 0 },
      metrics: saved.metrics.map((metric) => ({
        ...metric,
        icon_style: "filled" as const,
        pair_with: null,
      })),
    };
    const applied = applyWidgetPreset(changed, "距离");
    expect(applied?.layout.metric_gap).toBe(17);
    expect(applied?.layout.mode).toBe("compact");
    expect(applied?.metrics.every((metric) => metric.icon_style === "text")).toBe(true);
    expect(applied?.metrics.map((metric) => metric.pair_with)).toEqual(["cpu", "upload"]);
    expect(saved.presets[0].layout.metric_gap).toBe(17);
  });
});
