import { describe, expect, it, vi } from "vitest";
import {
  createTranslationSettingsWriter,
  translationConfigured,
  discardCredentialEdits,
} from "./translationSettingsSave";
import { translationApi, type TranslationSettings } from "../api/translation";
import { settingsDraft } from "../api/translation";

it("服务是否启用由后端测试状态决定，保存表单不伪造测试成功", () => {
  const view: TranslationSettings = {
    provider: "baidu",
    source: "auto",
    target: "zh",
    baiduAppId: "123",
    baiduKeyConfigured: true,
    deeplKeyConfigured: false,
    deeplFree: true,
    credentialError: null,
    baiduVerified: true,
    deeplVerified: false,
  };
  const draft = settingsDraft(view);
  expect(draft.provider).toBe("baidu");
  expect(draft).not.toHaveProperty("baiduVerified");
  expect(draft).not.toHaveProperty("deeplVerified");
});

describe("翻译设置分别保存", () => {
  it("语言保存不提交编辑中的密钥，随后保存凭据保留最新语言", async () => {
    let current: TranslationSettings = {
      provider: "baidu",
      source: "auto",
      target: "zh",
      baiduAppId: "",
      baiduKeyConfigured: false,
      deeplKeyConfigured: false,
      deeplFree: true,
      credentialError: null,
    };
    const save = vi.fn(async (draft) => {
      current = {
        ...current,
        ...draft,
        baiduKeyConfigured: Boolean(draft.baiduKey) || current.baiduKeyConfigured,
      };
      return current;
    });
    const write = createTranslationSettingsWriter({
      ...translationApi,
      settings: async () => current,
      save,
    });
    const language = write({ target: "ja" });
    const credentials = write({ baiduAppId: "123", baiduKey: "private" });
    await Promise.all([language, credentials]);
    expect(save.mock.calls[0][0].baiduKey).toBeNull();
    expect(save.mock.calls[1][0].target).toBe("ja");
    expect(current.baiduKeyConfigured).toBe(true);
  });
  it("保存失败后仍可重试且不覆盖另一服务凭据", async () => {
    const current = {
      provider: "deepl",
      source: "auto",
      target: "zh",
      baiduAppId: "123",
      baiduKeyConfigured: true,
      deeplKeyConfigured: true,
      deeplFree: true,
      credentialError: null,
    } as TranslationSettings;
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("磁盘写入失败"))
      .mockResolvedValue(current);
    const write = createTranslationSettingsWriter({
      ...translationApi,
      settings: async () => current,
      save,
    });
    await expect(write({ provider: "baidu" })).rejects.toThrow("磁盘写入失败");
    await write({ provider: "baidu" });
    expect(save.mock.calls[1][0]).toMatchObject({ baiduKey: null, deeplKey: null });
  });
});

it("首次未配置展开，保存后摘要可用，取消编辑恢复凭据但保留语言", () => {
  const saved: TranslationSettings = {
    provider: "baidu",
    source: "auto",
    target: "zh",
    baiduAppId: "",
    baiduKeyConfigured: false,
    deeplKeyConfigured: false,
    deeplFree: true,
    credentialError: null,
  };
  expect(translationConfigured(saved)).toBe(false);
  const configured = { ...saved, baiduAppId: "123", baiduKeyConfigured: true };
  expect(translationConfigured(configured)).toBe(true);
  const reverted = discardCredentialEdits(configured, {
    ...configured,
    source: "en",
    target: "ja",
    baiduAppId: "999",
    baiduKey: "unsaved",
    deeplKey: null,
  });
  expect(reverted).toMatchObject({ baiduAppId: "123", baiduKey: null, source: "en", target: "ja" });
});
