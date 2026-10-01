import { describe, expect, it } from "vitest";
import { createTelemetryStore } from "./telemetryStore";
describe("后台系统采样", () => {
  it("隐藏窗口继续收集，重新显示时发布最新状态", () => {
    const store = createTelemetryStore({
      status: null,
      lastSampleAt: null,
      samples: [],
      archive: [],
      alerts: [],
    });
    let notifications = 0;
    const off = store.subscribe(() => {
      notifications += 1;
    });
    store.setVisible(false);
    store.update({ lastSampleAt: 100 });
    store.update({ lastSampleAt: 200 });
    expect(notifications).toBe(0);
    expect(store.getPublishedSnapshot().lastSampleAt).toBeNull();
    store.setVisible(true);
    expect(notifications).toBe(1);
    expect(store.getPublishedSnapshot().lastSampleAt).toBe(200);
    off();
    store.update({ lastSampleAt: 300 });
    expect(notifications).toBe(1);
  });
});
