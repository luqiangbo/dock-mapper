import {
  translationSettingsError,
  type TranslationSettingsDraft,
  type TranslationProvider,
  type TranslationLanguage,
  type TargetLanguage,
} from "../api/translation";

export interface TranslationTrialResult {
  text: string;
  provider: TranslationProvider;
  source: TranslationLanguage;
  target: TargetLanguage;
  elapsedMs: number;
}
export interface TranslationTrialState {
  pending: boolean;
  result: TranslationTrialResult | null;
  error: string;
  copy: "idle" | "copied" | "failed";
}
export const EMPTY_TRIAL: TranslationTrialState = {
  pending: false,
  result: null,
  error: "",
  copy: "idle",
};

export function trialValidation(draft: TranslationSettingsDraft, text: string) {
  if (translationSettingsError(draft)) return translationSettingsError(draft);
  if (!text.trim()) return "请输入需要测试的文字";
  if (Array.from(text).length > 5000) return "测试文本超过 5,000 字符，请缩短后重试";
  return "";
}

/** Trial text/credentials never enter persisted settings, logs or result metadata. */
export class TranslationTrial {
  private revision = 0;
  state = EMPTY_TRIAL;
  constructor(
    private update: (state: TranslationTrialState) => void,
    private now = () => performance.now(),
  ) {}
  private publish(state: TranslationTrialState) {
    this.state = state;
    this.update(state);
  }
  dispose() {
    this.revision++;
  }
  invalidate() {
    this.dispose();
    this.publish(EMPTY_TRIAL);
  }
  run(
    draft: TranslationSettingsDraft,
    text: string,
    execute: (draft: TranslationSettingsDraft, text: string) => Promise<string>,
  ) {
    if (this.state.pending) return;
    const error = trialValidation(draft, text);
    if (error) {
      this.publish({ ...EMPTY_TRIAL, error });
      return;
    }
    const revision = ++this.revision;
    const snapshot = { ...draft };
    const started = this.now();
    this.publish({ ...EMPTY_TRIAL, pending: true });
    void Promise.resolve().then(async () => {
      if (revision !== this.revision) return;
      try {
        const translated = await execute(snapshot, text);
        if (revision !== this.revision) return;
        if (!translated.trim()) throw new Error("翻译服务返回了空译文，请重试");
        this.publish({
          ...EMPTY_TRIAL,
          result: {
            text: translated,
            provider: snapshot.provider,
            source: snapshot.source,
            target: snapshot.target,
            elapsedMs: Math.max(0, Math.round(this.now() - started)),
          },
        });
      } catch (error) {
        if (revision === this.revision) this.publish({ ...EMPTY_TRIAL, error: String(error) });
      }
    });
  }
  async copy(execute: (text: string) => Promise<boolean>) {
    const result = this.state.result;
    if (!result) return;
    const revision = this.revision;
    try {
      if (!(await execute(result.text))) throw new Error("剪贴板未接受译文");
      if (revision === this.revision) this.publish({ ...this.state, copy: "copied" });
    } catch {
      if (revision === this.revision) this.publish({ ...this.state, copy: "failed" });
    }
  }
}
