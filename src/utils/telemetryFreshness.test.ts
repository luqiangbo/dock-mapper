import { describe, expect, it } from "vitest";
import { telemetryFreshness } from "./telemetryFreshness";

describe("系统采样状态", () => {
  it("首次采样前显示等待，而不是零值", () => {
    expect(telemetryFreshness(null, 20_000)).toBe("waiting");
  });

  it("采样中断超过十五秒后标记过期", () => {
    expect(telemetryFreshness(1_000, 16_000)).toBe("live");
    expect(telemetryFreshness(1_000, 16_001)).toBe("stale");
  });
});
