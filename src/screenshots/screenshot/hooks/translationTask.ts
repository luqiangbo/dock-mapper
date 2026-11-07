import type { OcrResult } from "../../../api/screenshotTypes";
import type {
  BlockTranslationRequest,
  TranslationBlock,
  TranslationSettings,
} from "../../../api/translation";

export interface InlineTranslationState {
  phase: "idle" | "waiting-ocr" | "pending" | "ready" | "error" | "empty";
  visible: boolean;
  error: string;
  blocks: TranslationBlock[] | null;
  source: OcrResult | null;
}
export const EMPTY_TRANSLATION: InlineTranslationState = {
  phase: "idle",
  visible: false,
  error: "",
  blocks: null,
  source: null,
};

export class TranslationTask {
  private generation = 0;
  state: InlineTranslationState = EMPTY_TRANSLATION;
  constructor(private update: (state: InlineTranslationState) => void) {}
  private publish(state: InlineTranslationState) {
    this.state = state;
    this.update(state);
  }
  cancel() {
    this.generation++;
  }
  reset() {
    this.cancel();
    this.publish(EMPTY_TRANSLATION);
  }
  fail(error: string) {
    this.cancel();
    this.publish({ ...EMPTY_TRANSLATION, phase: "error", error });
  }
  toggle() {
    if (this.state.phase === "pending" || this.state.phase === "waiting-ocr") return;
    if (this.state.phase === "ready") {
      this.publish({ ...this.state, visible: !this.state.visible });
      return;
    }
    this.publish({ ...EMPTY_TRANSLATION, phase: "waiting-ocr" });
  }
  start(
    source: OcrResult,
    settings: () => Promise<TranslationSettings>,
    execute: (request: BlockTranslationRequest) => Promise<TranslationBlock[]>,
  ) {
    if (this.state.phase !== "waiting-ocr") return;
    const blocks = source.blocks
      .map((block, id) => ({ id, text: block.text }))
      .filter((block) => block.text.trim());
    if (!blocks.length) {
      this.publish({ ...EMPTY_TRANSLATION, phase: "empty" });
      return;
    }
    if (blocks.reduce((count, block) => count + Array.from(block.text).length, 0) > 5000) {
      this.fail("文字超过 5,000 字符，请缩小选区");
      return;
    }
    const generation = ++this.generation;
    this.publish({ ...EMPTY_TRANSLATION, phase: "pending", source });
    void Promise.resolve().then(async () => {
      if (generation !== this.generation) return;
      try {
        const config = await settings();
        if (generation !== this.generation) return;
        const translated = await execute({
          blocks,
          provider: config.provider,
          source: config.source,
          target: config.target,
        });
        if (generation !== this.generation) return;
        const mapped = new Map(translated.map((block) => [block.id, block.text]));
        if (
          mapped.size !== blocks.length ||
          translated.length !== blocks.length ||
          blocks.some((block) => !mapped.get(block.id)?.trim())
        ) {
          throw new Error("译文文字块不完整，请重试");
        }
        this.publish({
          phase: "ready",
          visible: true,
          error: "",
          source,
          blocks: blocks.map((block) => ({ id: block.id, text: mapped.get(block.id)! })),
        });
      } catch (error) {
        if (generation === this.generation) this.fail(String(error));
      }
    });
  }
}
