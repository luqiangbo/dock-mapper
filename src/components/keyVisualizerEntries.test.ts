import { describe, expect, it } from "vitest";
import {
  appendKeyVisualizerEntry,
  clampKeyVisualizerOpacity,
  KEY_VISUALIZER_CHARACTER_EMOJIS,
  keyVisualizerEntryOpacity,
  keyVisualizerToggleLabel,
  randomCharacterEmoji,
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
  it("连续字符合并为一条随机 Emoji 且不暴露真实内容", () => {
    let entries = appendKeyVisualizerEntry([], input("a", 1, 100), () => 0);
    entries = appendKeyVisualizerEntry(entries, input("B", 1, 200), () => 0.99);
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe("😀🎈");
    expect(entries[0].label).not.toMatch(/[aB]/);
    expect(entries[0].repeat).toBe(1);
  });

  it("随机数映射到 Emoji 列表且处理边界值", () => {
    expect(randomCharacterEmoji(() => -1)).toBe(KEY_VISUALIZER_CHARACTER_EMOJIS[0]);
    expect(randomCharacterEmoji(() => 0)).toBe("😀");
    expect(randomCharacterEmoji(() => 1)).toBe("🎈");
  });

  it("Emoji 合并按完整字符截断，不产生代理对乱码", () => {
    let entries = appendKeyVisualizerEntry([], input("secret", 1, 100), () => 0);
    for (let index = 0; index < 20; index += 1) {
      entries = appendKeyVisualizerEntry(entries, input(String(index), 1, 200 + index), () => 0);
    }
    expect(Array.from(entries[0].label)).toHaveLength(14);
    expect(entries[0].label).toBe("😀".repeat(14));
    expect(entries[0].label).not.toContain("secret");
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
