import { describe, expect, it } from "vitest";
import type { WidgetConfig } from "../types";
import { applyWidgetPreset, deleteWidgetPreset, saveCurrentWidgetPreset } from "./widgetPresets";

const config: WidgetConfig = {
  memory_scheme: "capsule",
  metrics: [
    { kind: "network", enabled: true, usage_scheme: "capsule" },
    { kind: "cpu", enabled: true, usage_scheme: "ring" },
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
    const changed = { ...saved, metrics: [...saved.metrics].reverse(), refresh_interval_secs: 5, speed_unit: "auto" as const };
    const applied = applyWidgetPreset(changed, "办公");
    expect(applied?.metrics.map((item) => item.kind)).toEqual(["network", "cpu"]);
    expect(applied?.refresh_interval_secs).toBe(2);
    expect(applied?.speed_unit).toBe("mb");
    expect(applied?.alerts.cpu_percent).toBe(85);
  });

  it("删除预设后重新进入时列表不再包含它", () => {
    const saved = saveCurrentWidgetPreset(config, "办公");
    expect(deleteWidgetPreset(saved, "办公").presets).toEqual([]);
  });
});
