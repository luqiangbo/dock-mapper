import { describe, expect, it } from "vitest";
import {
  appendKeyVisualizerEntry,
  clampKeyVisualizerOpacity,
  keyVisualizerEntryOpacity,
  keyVisualizerToggleLabel,
  removeExpiredKeyVisualizerEntries,
} from "./keyVisualizerEntries";

const input = (label: string, repeat: number, timestamp_ms: number) => ({
  label,
  repeat,
  timestamp_ms,
  category: "character" as const,
});

describe("按键文本最近列表", () => {
  it("连续同键合并并限制为最近五条", () => {
    let entries = appendKeyVisualizerEntry([], input("A", 1, 100));
    entries = appendKeyVisualizerEntry(entries, input("A", 2, 200));
    expect(entries).toHaveLength(1);
    expect(entries[0].repeat).toBe(2);
    for (let index = 0; index < 6; index += 1) {
      entries = appendKeyVisualizerEntry(entries, input(String(index), 1, 300 + index));
    }
    expect(entries).toHaveLength(5);
  });

  it("三秒后移除单条输入", () => {
    const entries = appendKeyVisualizerEntry([], input("Enter", 1, 100));
    expect(removeExpiredKeyVisualizerEntries(entries, 3_100)).toEqual([]);
  });

  it("组合用户透明度与末段淡出并归一化边界", () => {
    expect(clampKeyVisualizerOpacity(5)).toBe(20);
    expect(clampKeyVisualizerOpacity(120)).toBe(100);
    expect(keyVisualizerEntryOpacity(60, 1_000, 3_750)).toBeCloseTo(0.3);
  });

  it("为显示状态提供明确按钮文字", () => {
    expect(keyVisualizerToggleLabel(false)).toBe("显示按键文本");
    expect(keyVisualizerToggleLabel(true)).toBe("隐藏按键文本");
  });
});
