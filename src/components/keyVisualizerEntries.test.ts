import { describe, expect, it } from "vitest";
import {
  appendKeyVisualizerEntry,
  clampKeyVisualizerOpacity,
  keyVisualizerEntryOpacity,
  keyVisualizerToggleLabel,
  privacyCharacterToken,
  removeExpiredKeyVisualizerEntries,
} from "./keyVisualizerEntries";

const input = (label: string, repeat: number, timestamp_ms: number) => ({
  generation: 1,
  label,
  repeat,
  timestamp_ms,
  category: "character" as const,
});

describe("按键文本最近列表", () => {
  it("连续字符合并为一条并随机混入星号", () => {
    let entries = appendKeyVisualizerEntry([], input("a", 1, 100), () => 0.9);
    entries = appendKeyVisualizerEntry(entries, input("B", 1, 200), () => 0.15);
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe("aB*");
    expect(entries[0].repeat).toBe(1);
  });

  it("字符脱敏以低频替换或追加星号并保留可见字母的大小写", () => {
    expect(privacyCharacterToken("a", () => 0)).toBe("*");
    expect(privacyCharacterToken("a", () => 0.15)).toBe("a*");
    expect(privacyCharacterToken("a", () => 0.9)).toBe("a");
    expect(privacyCharacterToken("A", () => 0.9)).toBe("A");
  });

  it("非连续条目限制为最近五条", () => {
    let entries = appendKeyVisualizerEntry([], { ...input("Enter", 1, 100), category: "other" });
    for (let index = 0; index < 6; index += 1) {
      entries = appendKeyVisualizerEntry(entries, {
        ...input(`F${index + 1}`, 1, 300 + index),
        category: "other",
      });
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
