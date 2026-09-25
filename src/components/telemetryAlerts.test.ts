import { describe, expect, it, vi } from "vitest";
import { evaluateTelemetryAlerts, initialAlertState, loadAlertInbox, saveAlertInbox } from "./telemetryAlerts";

const rules = { cpu_percent: 80, memory_percent: null, battery_below_percent: null };
const highCpu = { upload_speed: 0, download_speed: 0, memory_usage: 40, network_available: true, cpu_usage: 90 };

describe("本地阈值提醒", () => {
  it("持续超过阈值才生成一条提醒，冷却期间不重复提醒", () => {
    let state = initialAlertState();
    for (let time = 1; time <= 2; time += 1) {
      const result = evaluateTelemetryAlerts(state, rules, highCpu, time * 1000);
      state = result.state;
      expect(result.alerts).toHaveLength(0);
    }
    const fired = evaluateTelemetryAlerts(state, rules, highCpu, 3_000);
    expect(fired.alerts).toHaveLength(1);
    const again = evaluateTelemetryAlerts(fired.state, rules, highCpu, 4_000);
    expect(again.alerts).toHaveLength(0);
  });

  it("恢复正常后再次越界可生成新的提醒", () => {
    let state = initialAlertState();
    for (let time = 1; time <= 3; time += 1) state = evaluateTelemetryAlerts(state, rules, highCpu, time * 1000).state;
    state = evaluateTelemetryAlerts(state, rules, { ...highCpu, cpu_usage: 20 }, 4_000).state;
    let result = evaluateTelemetryAlerts(state, rules, highCpu, 700_000);
    result = evaluateTelemetryAlerts(result.state, rules, highCpu, 701_000);
    result = evaluateTelemetryAlerts(result.state, rules, highCpu, 702_000);
    expect(result.alerts).toHaveLength(1);
  });

  it("重开主窗口后仍能读取未读提醒", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    } });
    const alert = { id: "cpu-3000", kind: "cpu" as const, value: 90, threshold: 80, createdAt: 3000, read: false };
    saveAlertInbox([alert]);
    expect(loadAlertInbox()).toEqual([alert]);
    const restored = initialAlertState(loadAlertInbox());
    expect(restored.lastAlertAt.cpu).toBe(3000);
    let next = evaluateTelemetryAlerts(restored, rules, highCpu, 4_000);
    next = evaluateTelemetryAlerts(next.state, rules, highCpu, 5_000);
    next = evaluateTelemetryAlerts(next.state, rules, highCpu, 6_000);
    expect(next.alerts).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
