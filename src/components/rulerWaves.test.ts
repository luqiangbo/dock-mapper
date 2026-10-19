import { describe, expect, it } from "vitest";
import { createRulerWaves, createRulerWavePattern } from "./rulerWaves";

describe("密集水波与当前位置高峰", () => {
  it("柱数随高度变化，约每 4 px 一条；不可见高度不生成柱条", () => {
    expect(createRulerWaves(600, 50)).toHaveLength(150);
    expect(createRulerWaves(1200, 50)).toHaveLength(300);
    expect(createRulerWaves(601, 50)).toHaveLength(151);
    expect(createRulerWaves(0, 50)).toEqual([]);
    expect(createRulerWaves(-1, 50)).toEqual([]);
    expect(createRulerWaves(NaN, 50)).toEqual([]);
  });
  it("当前位置柱长和幅度明显更大，远处保持低矮慢动", () => {
    const bars = createRulerWaves(600, 50);
    const center = bars[75];
    expect(center.low * 18).toBeGreaterThan(11.9);
    expect(center.high * 18).toBeGreaterThan(17.9);
    expect(center.drift).toBeGreaterThan(0.89);
    expect(center.duration).toBeGreaterThanOrEqual(6);
    expect(center.duration).toBeLessThan(9);
    expect(bars[0].low * 18).toBeCloseTo(2.5);
    expect(bars[0].high * 18).toBeCloseTo(3.5);
    expect(bars[0].drift).toBe(0.25);
    expect(bars[0].duration).toBeGreaterThanOrEqual(6);
    expect(bars[75].high).toBeGreaterThan(bars[80].high);
    expect(bars[80].high).toBeGreaterThan(bars[85].high);
    expect(bars[85].high).toBeGreaterThan(bars[95].high);
  });
  it("高峰跟随滚动位置移动，顶部和底部仍保留明显高峰", () => {
    const top = createRulerWaves(600, 0);
    const bottom = createRulerWaves(600, 100);
    expect(top[0].high * 18).toBeGreaterThan(17.9);
    expect(top[149].high * 18).toBeCloseTo(3.5);
    expect(bottom[0].high * 18).toBeCloseTo(3.5);
    expect(bottom[149].high * 18).toBeGreaterThan(17.9);
    expect(createRulerWaves(600, -10)).toEqual(top);
    expect(createRulerWaves(600, 110)).toEqual(bottom);
  });
  it("重读和缩放不重新随机节奏，滚动不会改变各柱相位", () => {
    expect(createRulerWaves(600, 50)).toEqual(createRulerWaves(600, 50));
    const phases = createRulerWaves(600, 0).map((bar) => bar.delay);
    expect(createRulerWaves(600, 100).map((bar) => bar.delay)).toEqual(phases);
    expect(
      createRulerWaves(1200, 50)
        .slice(0, phases.length)
        .map((bar) => bar.delay),
    ).toEqual(phases);
    expect(phases[0]).not.toBe(phases[1]);
  });
  it("任意位置的长度和浮动均限制在操作区域内", () => {
    for (const percent of [0, 1, 25, 50, 99, 100]) {
      for (const bar of createRulerWaves(720, percent)) {
        expect(bar.low * 18).toBeGreaterThanOrEqual(2.5);
        expect(bar.high * 18).toBeLessThanOrEqual(18);
        expect(bar.high).toBeGreaterThan(bar.low);
        expect(bar.drift).toBeGreaterThanOrEqual(0.25);
        expect(bar.drift).toBeLessThanOrEqual(0.9);
        expect(bar.duration).toBeGreaterThanOrEqual(6);
        expect(bar.duration).toBeLessThan(9);
        expect(bar.delay).toBeLessThanOrEqual(0);
        expect(bar.frames).toHaveLength(9);
        expect(bar.frames[8]).toEqual(bar.frames[0]);
        for (const frame of bar.frames) {
          expect(frame.scale).toBeGreaterThanOrEqual(bar.low);
          expect(frame.scale).toBeLessThanOrEqual(bar.high);
          expect(Math.abs(frame.offset)).toBeLessThanOrEqual(bar.drift);
        }
      }
    }
  });
});

describe("音乐感随机节点", () => {
  it("同种子同索引保持相同，换种子或柱条会产生不同节奏", () => {
    expect(createRulerWavePattern(123, 8)).toEqual(createRulerWavePattern(123, 8));
    expect(createRulerWavePattern(123, 8)).not.toEqual(createRulerWavePattern(456, 8));
    expect(createRulerWavePattern(123, 8)).not.toEqual(createRulerWavePattern(123, 9));
  });
  it("八个独立高低节点首尾衔接，变化不再只是规律的一高一低", () => {
    const { nodes } = createRulerWavePattern(123, 8);
    expect(nodes).toHaveLength(9);
    expect(nodes[8]).toEqual(nodes[0]);
    expect(new Set(nodes.slice(0, 8).map((node) => node.level)).size).toBe(8);
    for (const node of nodes) {
      expect(node.level).toBeGreaterThanOrEqual(0);
      expect(node.level).toBeLessThanOrEqual(1);
      expect(Math.abs(node.drift)).toBeLessThanOrEqual(1);
    }
  });
  it("滚动和缩放只更新高峰范围，不改变各柱的周期、相位或归一化节点", () => {
    const first = createRulerWaves(600, 0, 42)[30];
    const moved = createRulerWaves(1200, 50, 42)[30];
    expect(first.duration).toBe(moved.duration);
    expect(first.delay).toBe(moved.delay);
    const normalized = (bar: typeof first) =>
      bar.frames.map((frame) => (frame.scale - bar.low) / (bar.high - bar.low));
    normalized(first).forEach((node, index) => expect(node).toBeCloseTo(normalized(moved)[index]));
    const top = createRulerWaves(600, 0, 42);
    const bottom = createRulerWaves(600, 100, 42);
    expect(Math.min(...top[0].frames.map((frame) => frame.scale * 18))).toBeGreaterThan(11.9);
    expect(Math.min(...bottom[149].frames.map((frame) => frame.scale * 18))).toBeGreaterThan(11.9);
    expect(Math.max(...top[149].frames.map((frame) => frame.scale * 18))).toBeLessThanOrEqual(3.5);
  });
});
