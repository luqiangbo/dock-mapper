import { describe, expect, it, vi } from "vitest";
import { createPinOptionStager } from "./pinOptionStager";
describe("贴图退出前的最新状态", () => {
  it("首个回执未返回时也立即将最后一次透明度交给原生层", async () => {
    let resolve!: (value: { opacity: number; locked: boolean }) => void;
    const first = new Promise<{ opacity: number; locked: boolean }>((done) => {
      resolve = done;
    });
    const save = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementation((value) => Promise.resolve(value));
    const saved = vi.fn();
    const stage = createPinOptionStager({
      save,
      onSaved: saved,
      onError: vi.fn(),
      onBusyChange: vi.fn(),
    });
    stage.write({ opacity: 0.8, locked: false });
    stage.write({ opacity: 0.4, locked: false });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ opacity: 0.4, locked: false });
    resolve({ opacity: 0.8, locked: false });
    await stage.whenIdle();
    expect(saved).toHaveBeenCalledWith({ opacity: 0.8, locked: false }, false);
  });
  it("失败后重试继续提交最新草稿", async () => {
    const error = vi.fn(),
      saved = vi.fn();
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("原生层繁忙"))
      .mockResolvedValue({ opacity: 0.4, locked: true });
    const stage = createPinOptionStager({
      save,
      onSaved: saved,
      onError: error,
      onBusyChange: vi.fn(),
    });
    stage.write({ opacity: 0.4, locked: true });
    await stage.whenIdle();
    expect(error).toHaveBeenCalled();
    stage.write({ opacity: 0.4, locked: true });
    await stage.whenIdle();
    expect(saved).toHaveBeenCalledWith({ opacity: 0.4, locked: true }, true);
  });
});
