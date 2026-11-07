import { invokeCommand } from "./ipc";

export type TranslationProvider = "baidu" | "deepl";
export type TranslationLanguage = "auto" | "zh" | "en" | "ja" | "ko";
export type TargetLanguage = Exclude<TranslationLanguage, "auto">;
export interface TranslationSettings {
  provider: TranslationProvider;
  source: TranslationLanguage;
  target: TargetLanguage;
  deeplFree: boolean;
  baiduAppId: string;
  baiduKeyConfigured: boolean;
  deeplKeyConfigured: boolean;
  credentialError: string | null;
  baiduVerified?: boolean;
  deeplVerified?: boolean;
}
export interface TranslationSettingsDraft extends Omit<
  TranslationSettings,
  | "baiduKeyConfigured"
  | "deeplKeyConfigured"
  | "credentialError"
  | "baiduVerified"
  | "deeplVerified"
> {
  /** null keeps the saved key, an empty string explicitly clears it. */
  baiduKey: string | null;
  deeplKey: string | null;
}
export interface TranslationRequest {
  text: string;
  provider: TranslationProvider;
  source: TranslationLanguage;
  target: TargetLanguage;
}
export interface TranslationBlock {
  id: number;
  text: string;
}
export interface BlockTranslationRequest extends Omit<TranslationRequest, "text"> {
  blocks: TranslationBlock[];
}
export const TRANSLATION_PROVIDERS = [
  { value: "baidu", label: "百度翻译" },
  { value: "deepl", label: "DeepL" },
];
export const TARGET_LANGUAGES = [
  { value: "zh", label: "简体中文" },
  { value: "en", label: "英语" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
];
export const SOURCE_LANGUAGES = [{ value: "auto", label: "自动检测" }, ...TARGET_LANGUAGES];
export function translationSettingsError(draft: TranslationSettingsDraft) {
  return draft.provider === "baidu" &&
    draft.baiduAppId &&
    !/^\d{1,64}$/.test(draft.baiduAppId.trim())
    ? "百度 App ID 应为数字"
    : "";
}
export function translationProviderLabel(provider: TranslationProvider) {
  return provider === "baidu" ? "百度翻译" : "DeepL";
}
export function settingsDraft(settings: TranslationSettings): TranslationSettingsDraft {
  const {
    baiduKeyConfigured: _baidu,
    deeplKeyConfigured: _deepl,
    credentialError: _error,
    baiduVerified: _baiduVerified,
    deeplVerified: _deeplVerified,
    ...values
  } = settings;
  return { ...values, baiduKey: null, deeplKey: null };
}
export const translationApi = {
  settings: () => invokeCommand("get_translation_settings"),
  save: (draft: TranslationSettingsDraft) =>
    invokeCommand("update_translation_settings", { draft }),
  test: (draft: TranslationSettingsDraft, text: string) =>
    invokeCommand("test_translation_service", { draft, text }),
  copy: (text: string) => invokeCommand("copy_text", { value: text }),
  translate: (request: TranslationRequest) => invokeCommand("translate_text", { request }),
  translateBlocks: (request: BlockTranslationRequest) =>
    invokeCommand("translate_ocr_blocks", { request }),
};
