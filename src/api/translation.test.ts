import { describe, expect, it } from "vitest";
import { settingsDraft, TRANSLATION_PROVIDERS, translationSettingsError } from "./translation";

describe("官方翻译服务配置", () => {
  it("只提供百度和 DeepL，默认凭据读取不包含明文 Key", () => {
    expect(TRANSLATION_PROVIDERS.map((item) => item.value)).toEqual(["baidu", "deepl"]);
    const draft = settingsDraft({
      provider: "baidu",
      source: "auto",
      target: "zh",
      deeplFree: true,
      baiduAppId: "123456",
      baiduKeyConfigured: true,
      deeplKeyConfigured: true,
      credentialError: null,
    });
    expect(draft.baiduKey).toBeNull();
    expect(draft.deeplKey).toBeNull();
    expect(draft.baiduAppId).toBe("123456");
    expect(draft).not.toHaveProperty("baiduKeyConfigured");
    expect(draft).not.toHaveProperty("credentialError");
    expect(translationSettingsError(draft)).toBe("");
    expect(translationSettingsError({ ...draft, baiduAppId: "bad id" })).toContain("App ID");
    expect(
      translationSettingsError({ ...draft, provider: "deepl", baiduAppId: "unfinished id" }),
    ).toBe("");
  });
});
