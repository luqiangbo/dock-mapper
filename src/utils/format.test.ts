import { describe, expect, it } from "vitest";
import { formatSpeed, formatSpeedParts } from "./format";

describe("网速格式化", () => {
  it("按 B、KB、MB 分级显示", () => {
    expect(formatSpeed(512)).toBe("512 B/s");
    expect(formatSpeed(1536)).toBe("1.5 KB/s");
    expect(formatSpeed(2 * 1024 * 1024)).toBe("2.0 MB/s");
  });

  it("为任务栏挂件分离数值与单位", () => {
    expect(formatSpeedParts(1536)).toEqual({ value: "1.5", unit: "KB/s" });
    expect(formatSpeedParts(1536, "kb")).toEqual({ value: "1.5", unit: "KB/s" });
    expect(formatSpeedParts(2 * 1024 * 1024, "mb")).toEqual({ value: "2.0", unit: "MB/s" });
  });
});
