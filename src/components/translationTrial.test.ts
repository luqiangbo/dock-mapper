import { describe, expect, it, vi } from "vitest";
import { TranslationTrial, trialValidation } from "./translationTrial";
import type { TranslationSettingsDraft } from "../api/translation";

const draft: TranslationSettingsDraft = {
  provider: "baidu",
  source: "auto",
  target: "zh",
  deeplFree: true,
  baiduAppId: "123456",
  deeplKey: null,
  baiduKey: null,
};
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
describe("翻译设置中的实际试译", () => {
  it("发送当前表单和自定义文字，展示译文、服务、语言方向和耗时", async () => {
    const trial = new TranslationTrial(
      vi.fn(),
      vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(115),
    );
    const execute = vi.fn().mockResolvedValue("你好");
    const unsaved = { ...draft, provider: "deepl" as const };
    trial.run(unsaved, "Hello from my own input", execute);
    await settle();
    expect(execute).toHaveBeenCalledWith(unsaved, "Hello from my own input");
    expect(trial.state.result).toEqual({
      provider: "deepl",
      source: "auto",
      target: "zh",
      text: "你好",
      elapsedMs: 105,
    });
    expect(trial.state.result).not.toHaveProperty("deeplKey");
  });
  it("连续点击只提交一次，修改文字后丢弃旧结果", async () => {
    let finish!: (text: string) => void;
    const execute = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const trial = new TranslationTrial(vi.fn());
    trial.run(draft, "first", execute);
    trial.run(draft, "first", execute);
    await settle();
    expect(execute).toHaveBeenCalledOnce();
    trial.invalidate();
    finish("旧译文");
    await settle();
    expect(trial.state.result).toBeNull();
    expect(trial.state.pending).toBe(false);
  });
  it("切换服务或语言后新试译不被旧请求覆盖", async () => {
    let old!: (text: string) => void;
    const execute = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            old = resolve;
          }),
      )
      .mockResolvedValueOnce("こんにちは");
    const trial = new TranslationTrial(vi.fn());
    trial.run(draft, "Hello", execute);
    await settle();
    trial.invalidate();
    trial.run({ ...draft, provider: "deepl", target: "ja" }, "Hello", execute);
    await settle();
    old("旧中文");
    await settle();
    expect(trial.state.result?.text).toBe("こんにちは");
    expect(trial.state.result?.provider).toBe("deepl");
    expect(trial.state.result?.target).toBe("ja");
  });
  it("失败显示原因且能重试，复制失败保留译文供再次复制", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce("百度翻译 · 翻译请求：HTTP 429，服务限流")
      .mockResolvedValueOnce("你好");
    const trial = new TranslationTrial(vi.fn());
    trial.run(draft, "Hello", execute);
    await settle();
    expect(trial.state.error).toContain("429");
    trial.run(draft, "Hello", execute);
    await settle();
    await trial.copy(async () => false);
    expect(trial.state.copy).toBe("failed");
    expect(trial.state.result?.text).toBe("你好");
    await trial.copy(async () => true);
    expect(trial.state.copy).toBe("copied");
  });
  it("空文本、字符超限或 App ID 格式无效时不请求", async () => {
    const execute = vi.fn(),
      trial = new TranslationTrial(vi.fn());
    for (const text of [" \n ", "🙂".repeat(5001)]) {
      trial.run(draft, text, execute);
    }
    await settle();
    expect(execute).not.toHaveBeenCalled();
    expect(trialValidation({ ...draft, baiduAppId: "invalid-id" }, "Hello")).toContain("App ID");
    expect(trialValidation(draft, "Hello")).toBe("");
  });
  it("离开页面后忽略迟到的成功及复制反馈", async () => {
    const update = vi.fn();
    const trial = new TranslationTrial(update);
    let finish!: (text: string) => void;
    trial.run(
      draft,
      "Hello",
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    await settle();
    trial.dispose();
    update.mockClear();
    finish("迟到译文");
    await settle();
    expect(update).not.toHaveBeenCalled();
  });
});
