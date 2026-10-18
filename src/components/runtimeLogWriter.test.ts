import { describe, expect, it, vi } from "vitest";
import { createLogWriter } from "./runtimeLogWriter";
const record = { level: "info" as const, source: "settings" as const, message: "保存设置" };
describe("运行日志写入反馈", () => {
  it("失败不丢待写记录，用户重试后按顺序保存并清除错误", async () => {
    const write = vi.fn(async () => undefined).mockRejectedValueOnce(new Error("磁盘满"));
    const writer = createLogWriter(write);
    writer.record(record);
    await writer.retry();
    expect(writer.getSnapshot()).toMatchObject({ pending: 1 });
    expect(writer.getSnapshot().error).toContain("磁盘满");
    writer.record({ ...record, message: "下一条" });
    await writer.retry();
    expect(write).toHaveBeenCalledTimes(3);
    expect(writer.getSnapshot()).toEqual({ pending: 0, error: null });
  });
  it("待写队列满时明确说明新记录未保存", async () => {
    const writer = createLogWriter(async () => {
      throw new Error("拒绝写入");
    });
    writer.record(record);
    await writer.retry();
    for (let i = 0; i < 100; i++) writer.record(record);
    expect(writer.getSnapshot().pending).toBe(100);
    expect(writer.getSnapshot().error).toContain("新的记录未保存");
  });
});
