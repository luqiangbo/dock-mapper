import { describe, expect, it, vi } from "vitest";
import {
  appendTelemetryArchive,
  updateTelemetryArchive,
  loadTelemetryArchive,
  saveTelemetryArchive,
  selectTelemetryArchive,
} from "./telemetryArchive";

const sample = {
  upload_speed: 10,
  download_speed: 20,
  cpu_usage: 30,
  memory_usage: 40,
  network_available: true,
};

describe("本机长期趋势", () => {
  it("同分钟持续更新不改动已发布的趋势快照", () => {
    const buffer = updateTelemetryArchive([], sample, 60_100);
    const published = [...buffer];
    expect(updateTelemetryArchive(buffer, { ...sample, upload_speed: 50 }, 60_900)).toBe(buffer);
    expect(buffer).toHaveLength(1);
    expect(buffer[0].upload).toBe(50);
    expect(published[0].upload).toBe(10);
    updateTelemetryArchive(buffer, sample, 120_100);
    expect(buffer.map((item) => item.timestamp)).toEqual([60_000, 120_000]);
  });
  it("系统时间回退后趋势仍按时间排序且不重复分钟桶", () => {
    const buffer = updateTelemetryArchive([], sample, 120_100);
    updateTelemetryArchive(buffer, sample, 60_100);
    expect(buffer.map((item) => item.timestamp)).toEqual([60_000]);
  });
  it("同一分钟仅保留最近采样，重启后可读取小时视图", () => {
    const first = appendTelemetryArchive([], sample, 60_100);
    const next = appendTelemetryArchive(first, { ...sample, upload_speed: 15 }, 60_900);
    expect(next).toHaveLength(1);
    expect(selectTelemetryArchive(next, "hour", 61_000)[0].upload).toBe(15);
  });

  it("保留至多二十四小时并让不可用指标保持断点", () => {
    const first = appendTelemetryArchive([], sample, 60_000);
    const next = appendTelemetryArchive(
      first,
      { ...sample, network_available: false },
      24 * 60 * 60_000 + 120_000,
    );
    expect(next).toHaveLength(1);
    expect(next[0].upload).toBeNull();
  });

  it("采样中断时在长期趋势中留下断点", () => {
    const first = appendTelemetryArchive([], sample, 60_000);
    const next = appendTelemetryArchive(first, sample, 240_000);
    expect(selectTelemetryArchive(next, "hour", 250_000)[1]).toEqual({
      timestamp: 120_000,
      upload: null,
      download: null,
      cpu: null,
      memory: null,
    });
  });

  it("重开主窗口后仍能读取按分钟保存的趋势", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
    });
    saveTelemetryArchive(appendTelemetryArchive([], sample, 60_000));
    expect(loadTelemetryArchive()[0].timestamp).toBe(60_000);
    vi.unstubAllGlobals();
  });
});
