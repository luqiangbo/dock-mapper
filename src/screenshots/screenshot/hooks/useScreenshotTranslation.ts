import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { translationApi } from "../../../api/translation";
import type { OcrPanelState } from "./useOcr";
import { TranslationTask, EMPTY_TRANSLATION } from "./translationTask";
import {
  buildTranslationAppearance,
  type TranslationAppearance,
} from "../components/translationAppearance";
import { selectedOcrText } from "../components/OcrSelectionLayer";

export function useScreenshotTranslation(
  scope: string | null,
  ocr: OcrPanelState,
  base: HTMLCanvasElement | null,
  recognize: () => void,
) {
  const [state, setState] = useState(EMPTY_TRANSLATION);
  const task = useRef<TranslationTask | null>(null);
  if (!task.current) task.current = new TranslationTask(setState);
  const controller = task.current;
  const previous = useRef({ scope, source: ocr.result });
  const [appearance, setAppearance] = useState<TranslationAppearance | null>(null);
  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = { scope, source: ocr.result };
    if (old.scope !== scope || (old.source && old.source !== ocr.result)) {
      controller.reset();
      setAppearance(null);
    }
  }, [scope, ocr.result, controller]);
  useLayoutEffect(() => {
    if (!scope || state.phase !== "waiting-ocr") return;
    if (ocr.error) controller.fail(`文字识别失败：${ocr.error}`);
    else if (ocr.result)
      controller.start(ocr.result, translationApi.settings, translationApi.translateBlocks);
  }, [scope, state.phase, ocr.result, ocr.error, controller]);
  useLayoutEffect(() => {
    if (!state.blocks || !state.source || state.source !== ocr.result || !scope) {
      setAppearance(null);
      return;
    }
    if (!base) {
      controller.fail("截图底图尚未就绪，请重试");
      return;
    }
    try {
      setAppearance(buildTranslationAppearance(base, state.source, state.blocks));
    } catch (error) {
      controller.fail(String(error));
    }
  }, [state.blocks, state.source, ocr.result, base, scope, controller]);
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    void listen("translation-settings-changed", () => controller.reset())
      .then((unlisten) => {
        if (disposed) unlisten();
        else off = unlisten;
      })
      .catch(() => {
        if (!disposed) controller.fail("无法同步翻译设置，请重新截图后重试");
      });
    return () => {
      disposed = true;
      off?.();
      controller.cancel();
    };
  }, [controller]);
  const visible =
    state.visible && state.source === ocr.result && Boolean(scope) && Boolean(appearance);
  useLayoutEffect(() => {
    if (selectedOcrText()) window.getSelection()?.removeAllRanges();
  }, [visible]);
  const toggle = () => {
    if (!scope) return;
    if (ocr.error) {
      controller.reset();
      recognize();
    }
    controller.toggle();
    if (!ocr.result && !ocr.pending && !ocr.error) recognize();
  };
  const running = state.phase === "waiting-ocr" || state.phase === "pending";
  const feedback =
    state.phase === "waiting-ocr"
      ? "正在识别文字…"
      : state.phase === "pending"
        ? "正在翻译文字…"
        : state.phase === "error"
          ? state.error
          : state.phase === "empty"
            ? "未发现可翻译的文字"
            : state.phase === "ready"
              ? visible
                ? "已显示译文，点击翻译工具切回原文"
                : "已显示原文，点击翻译工具恢复译文"
              : "";
  return {
    toggle,
    running,
    visible,
    appearance: visible ? appearance : null,
    feedback,
    failed: state.phase === "error",
  };
}
