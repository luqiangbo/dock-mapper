import { describe, expect, it } from "vitest";
import { observeTelemetryVisibility } from "./telemetryVisibility";
import { createTelemetryStore } from "./telemetryStore";

describe("主窗口可见性与后台采样", () => {
  it("隐藏时保留采样，恢复后展示最新数据，不需要原生可见性查询", () => {
    const listeners = new Set<() => void>();
    const source = {
      hidden: false,
      addEventListener: (_type: "visibilitychange", listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: "visibilitychange", listener: () => void) => {
        listeners.delete(listener);
      },
    };
    const store = createTelemetryStore({
      status: null,
      lastSampleAt: null,
      samples: [],
      archive: [],
      alerts: [],
    });
    const visibility = observeTelemetryVisibility(source, store.setVisible);
    store.update({ lastSampleAt: 100 });
    expect(store.getPublishedSnapshot().lastSampleAt).toBe(100);
    source.hidden = true;
    listeners.forEach((listener) => listener());
    store.update({ lastSampleAt: 200 });
    expect(store.getPublishedSnapshot().lastSampleAt).toBe(100);
    expect(store.getSnapshot().lastSampleAt).toBe(200);
    source.hidden = false;
    visibility.refresh();
    expect(store.getPublishedSnapshot().lastSampleAt).toBe(200);
    visibility.dispose();
    expect(listeners.size).toBe(0);
  });
});
