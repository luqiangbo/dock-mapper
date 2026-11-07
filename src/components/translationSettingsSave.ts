import {
  settingsDraft,
  translationApi,
  type TranslationSettings,
  type TranslationSettingsDraft,
} from "../api/translation";

/** Merge each intent with the latest persisted settings, never with an editing form. */
export function createTranslationSettingsWriter(api = translationApi) {
  let pending = Promise.resolve();
  return (patch: Partial<TranslationSettingsDraft>) => {
    const snapshot = { ...patch };
    const operation = pending.then(async () => {
      const current = await api.settings();
      return api.save({ ...settingsDraft(current), ...snapshot });
    });
    // Keep the queue usable after failure; the returned operation still rejects for UI feedback.
    pending = operation.then(
      () => {},
      () => {},
    );
    return operation;
  };
}

export const saveTranslationSettingsPatch = createTranslationSettingsWriter();

export function translationConfigured(settings: TranslationSettings) {
  return settings.provider === "baidu"
    ? Boolean(settings.baiduAppId && settings.baiduKeyConfigured)
    : settings.deeplKeyConfigured;
}

export function discardCredentialEdits(
  saved: TranslationSettings,
  current: TranslationSettingsDraft,
) {
  return { ...settingsDraft(saved), source: current.source, target: current.target };
}
