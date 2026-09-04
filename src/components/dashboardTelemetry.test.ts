import { describe, expect, it } from "vitest";
import { appendDashboardSample, DASHBOARD_HISTORY_MS, DASHBOARD_MAX_SAMPLES } from "./dashboardTelemetry";
import type { DashboardSample } from "./dashboardTelemetry";

describe("仪表盘五分钟采样", () => {
  it("移除时间窗外数据并为不可用指标保留断点", () => {
    const now = 1_000_000;
    const result = appendDashboardSample(
      [{ timestamp: now - DASHBOARD_HISTORY_MS - 1, upload: 1, download: 2, cpu: 3, memory: 4 }],
      { upload_speed: 10, download_speed: 20, memory_usage: 30, network_available: false },
      now,
    );
    expect(result).toEqual([{ timestamp: now, upload: null, download: null, cpu: null, memory: 30 }]);
  });

  it("最多保留一个五分钟采样窗口", () => {
    const status = { upload_speed: 10, download_speed: 20, memory_usage: 30, network_available: true };
    let samples: DashboardSample[] = [];
    for (let index = 0; index < DASHBOARD_MAX_SAMPLES + 10; index += 1) {
      samples = appendDashboardSample(samples, status, 10_000 + index);
    }
    expect(samples).toHaveLength(DASHBOARD_MAX_SAMPLES);
  });
});
