import { describe, expect, it } from "vitest";
import { createLatestWriter } from "./latestWriter";
describe("连续调整贴图透明度", () => {
  it("串行保存并合并等待中的拖动，最终保留最后一次值", async () => {
    let resolveFirst!: (value: number) => void;
    const first = new Promise<number>((resolve) => {
      resolveFirst = resolve;
    });
    const writes: number[] = [];
    const visible: number[] = [];
    const writer = createLatestWriter<number, number>({
      save: async (value) => {
        writes.push(value);
        return writes.length === 1 ? first : value;
      },
      onSaved: (value, latest) => {
        if (latest) visible.push(value);
      },
      onError: () => {
        throw new Error("不应失败");
      },
    });
    writer.write(80);
    writer.write(60);
    writer.write(20);
    expect(writes).toEqual([80]);
    resolveFirst(80);
    await writer.whenIdle();
    expect(writes).toEqual([80, 20]);
    expect(visible).toEqual([20]);
    expect(writer.isBusy()).toBe(false);
  });
  it("保存失败仍能再次调整并成功保存", async () => {
    const errors: unknown[] = [];
    const saved: number[] = [];
    let fail = true;
    const writer = createLatestWriter<number, number>({
      save: async (value) => {
        if (fail) throw new Error("写入失败");
        return value;
      },
      onSaved: (value) => saved.push(value),
      onError: (error) => errors.push(error),
    });
    writer.write(40);
    await writer.whenIdle();
    expect(errors).toHaveLength(1);
    fail = false;
    writer.write(40);
    await writer.whenIdle();
    expect(saved).toEqual([40]);
  });
});
