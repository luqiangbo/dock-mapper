const BAR_WIDTH = 18;
const PEAK_RADIUS = 72;
const mix = (low: number, high: number, strength: number) => low + (high - low) * strength;

/** Each index owns a repeatable rhythm; geometry never re-samples it. */
export function createRulerWavePattern(seed: number, index: number) {
  let state = ((seed >>> 0) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0 || 0x12345678;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const duration = 6 + random() * 3;
  const delay = -random() * duration;
  const nodes = Array.from({ length: 8 }, () => ({
    level: 0.08 + random() * 0.84,
    drift: random() * 2 - 1,
  }));
  return { duration, delay, nodes: [...nodes, nodes[0]] };
}

/** CSS owns animation frames; only scroll position and geometry change this envelope. */
export function createRulerWaves(height: number, percent: number, seed = 0) {
  if (!Number.isFinite(height) || height <= 0) return [];
  const count = Math.ceil(height / 4);
  const peak = (height * Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0))) / 100;
  return Array.from({ length: count }, (_, index) => {
    const y = count === 1 ? height / 2 : 1.75 + (index * (height - 3.5)) / (count - 1);
    const distance = Math.abs(y - peak);
    const strength =
      distance >= PEAK_RADIUS ? 0 : (1 + Math.cos((Math.PI * distance) / PEAK_RADIUS)) / 2;
    const pattern = createRulerWavePattern(seed, index);
    const low = mix(2.5, 12, strength) / BAR_WIDTH;
    const high = mix(3.5, 18, strength) / BAR_WIDTH;
    const drift = mix(0.25, 0.9, strength);
    return {
      duration: pattern.duration,
      delay: pattern.delay,
      low,
      high,
      drift,
      frames: pattern.nodes.map((node) => ({
        scale: mix(low, high, node.level),
        offset: node.drift * drift,
      })),
      opacity: mix(0.45, 1, strength),
    };
  });
}
