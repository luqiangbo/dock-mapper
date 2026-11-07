import { describe, expect, it, vi } from "vitest";
import { TranslationTask } from "./translationTask";
import type { OcrResult } from "../../../api/screenshotTypes";
import type { TranslationBlock, TranslationSettings } from "../../../api/translation";

const source: OcrResult = {
  engine: "onnx",
  text: "Hello world",
  blocks: [
    { text: "Hello", confidence: 1, x: 0, y: 0, width: 80, height: 20 },
    { text: "world", confidence: 1, x: 0, y: 24, width: 80, height: 20 },
  ],
};
const settings = () =>
  Promise.resolve<TranslationSettings>({
    provider: "baidu",
    source: "auto",
    target: "zh",
    deeplFree: true,
    baiduAppId: "123456",
    credentialError: null,
    deeplKeyConfigured: false,
    baiduKeyConfigured: false,
  });
const translated = [
  { id: 1, text: "世界" },
  { id: 0, text: "你好" },
];
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe("原文和译文切换", () => {
  it("点击后等待 OCR，识别完成后才发送完整文字块", async () => {
    const task = new TranslationTask(vi.fn()),
      execute = vi.fn().mockResolvedValue(translated);
    task.toggle();
    expect(task.state.phase).toBe("waiting-ocr");
    expect(execute).not.toHaveBeenCalled();
    task.start(source, settings, execute);
    await settle();
    expect(execute.mock.calls[0][0].blocks).toEqual([
      { id: 0, text: "Hello" },
      { id: 1, text: "world" },
    ]);
    expect(task.state.visible).toBe(true);
    expect(task.state.blocks).toEqual([...translated].reverse());
  });
  it("原文与译文反复切换使用缓存，不再次请求也不改变源 OCR", async () => {
    const task = new TranslationTask(vi.fn()),
      execute = vi.fn().mockResolvedValue(translated);
    task.toggle();
    task.start(source, settings, execute);
    await settle();
    task.toggle();
    expect(task.state.visible).toBe(false);
    task.toggle();
    expect(task.state.visible).toBe(true);
    task.start(source, settings, execute);
    expect(execute).toHaveBeenCalledOnce();
    expect(source.blocks[0].text).toBe("Hello");
  });
  it("翻译中重复点击不重复请求，切换截图或设置后丢弃旧译文", async () => {
    let finish!: (result: TranslationBlock[]) => void;
    const execute = vi.fn(
      () =>
        new Promise<TranslationBlock[]>((resolve) => {
          finish = resolve;
        }),
    );
    const task = new TranslationTask(vi.fn());
    task.toggle();
    task.start(source, settings, execute);
    task.toggle();
    task.start(source, settings, execute);
    await settle();
    expect(execute).toHaveBeenCalledOnce();
    task.reset();
    finish(translated);
    await settle();
    expect(task.state.phase).toBe("idle");
    expect(task.state.visible).toBe(false);
  });
  it("全部译文返回才显示，缺失块时保留原文并允许重试", async () => {
    const task = new TranslationTask(vi.fn());
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ id: 0, text: "你好" }])
      .mockResolvedValueOnce(translated);
    task.toggle();
    task.start(source, settings, execute);
    await settle();
    expect(task.state.phase).toBe("error");
    expect(task.state.visible).toBe(false);
    task.toggle();
    task.start(source, settings, execute);
    await settle();
    expect(task.state.visible).toBe(true);
    expect(task.state.blocks).toHaveLength(2);
  });
  it("无文字或超出字符上限不会发送请求", async () => {
    const task = new TranslationTask(vi.fn()),
      execute = vi.fn();
    task.toggle();
    task.start({ ...source, blocks: [] }, settings, execute);
    expect(task.state.phase).toBe("empty");
    task.toggle();
    task.start(
      { ...source, blocks: [{ ...source.blocks[0], text: "字".repeat(5001) }] },
      settings,
      execute,
    );
    await settle();
    expect(execute).not.toHaveBeenCalled();
    expect(task.state.error).toContain("5,000");
  });
});
