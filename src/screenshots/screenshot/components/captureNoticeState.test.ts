import { describe, expect, it } from "vitest";
import { createCaptureNoticeState, createNoticePresentation } from "./captureNoticeState";
const hint = { error: false, progress: false, hint: true };
const progress = { ...hint, progress: true, hint: false };
const result = { ...hint, hint: false };

describe("截图始终只显示一个提示", () => {
  it("常驻提示被识别进度替换，进度完成后只显示结果，不重复常驻文案", () => {
    const notices = createCaptureNoticeState();
    const clearHint = notices.register("hint", hint);
    expect(notices.getSnapshot()).toBe("hint");
    const clearProgress = notices.register("ocr", progress);
    expect(notices.getSnapshot()).toBe("ocr");
    clearProgress();
    const clearResult = notices.register("ocr", result);
    expect(notices.getSnapshot()).toBe("ocr");
    clearResult();
    expect(notices.getSnapshot()).toBe("hint");
    clearHint();
    expect(notices.getSnapshot()).toBeNull();
  });
  it("多个结果只保留最新提示，错误优先且保留重试入口", () => {
    const notices = createCaptureNoticeState();
    notices.register("first", result);
    notices.register("second", result);
    expect(notices.getSnapshot()).toBe("second");
    const clearError = notices.register("error", { ...result, error: true });
    notices.register("progress", progress);
    expect(notices.getSnapshot()).toBe("error");
    clearError();
    expect(notices.getSnapshot()).toBe("progress");
  });
  it("关闭会话移除全部注册，下次打开不会残留旧提示", () => {
    const notices = createCaptureNoticeState();
    const cleanups = [notices.register("hint", hint), notices.register("progress", progress)];
    cleanups.forEach((cleanup) => cleanup());
    expect(notices.getSnapshot()).toBeNull();
    notices.register("next", hint);
    expect(notices.getSnapshot()).toBe("next");
  });
});

it("拖动期间进度卸载或重置仍保留当前文字，松手后才切换最新状态", () => {
  const notices = createCaptureNoticeState<string>();
  const present = createNoticePresentation<string>();
  const stop = notices.register("ocr", progress, "识别中…");
  expect(present(notices.getContent(), false)).toBe("识别中…");
  stop();
  expect(present(notices.getContent(), true)).toBe("识别中…");
  notices.register("hint", hint, "拖动移框");
  expect(present(notices.getContent(), true)).toBe("识别中…");
  notices.register("result", result, "已复制");
  expect(present(notices.getContent(), true)).toBe("识别中…");
  expect(present(notices.getContent(), false)).toBe("已复制");
});

it("同一提示从进度更新为结果时直接替换内容，不先注销显示", () => {
  const notices = createCaptureNoticeState<string>();
  notices.register("ocr", progress, "识别中…");
  const version = notices.getVersion();
  notices.register("ocr", result, "已复制");
  expect(notices.getSnapshot()).toBe("ocr");
  expect(notices.getContent()).toBe("已复制");
  expect(notices.getVersion()).toBeGreaterThan(version);
});

it("识别开始和结束都保留操作说明，只有状态内容发生变化", () => {
  const notices = createCaptureNoticeState<string>();
  const clearHint = notices.register("hint", hint, "拖动移框 · 拉边缩放");
  notices.register("ocr", progress, "识别中…");
  expect(notices.getHintContent()).toBe("拖动移框 · 拉边缩放");
  expect(notices.getContent()).toBe("识别中…");
  notices.register("ocr", result, "选字后 Ctrl+C 复制");
  expect(notices.getHintContent()).toBe("拖动移框 · 拉边缩放");
  expect(notices.getContent()).toBe("选字后 Ctrl+C 复制");
  notices.register("error", { ...result, error: true }, "识别失败");
  expect(notices.getContent()).toBe("识别失败");
  clearHint();
  expect(notices.getHintContent()).toBeNull();
});
