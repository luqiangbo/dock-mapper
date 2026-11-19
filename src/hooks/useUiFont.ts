import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invokeCommand } from "../api/ipc";
import {
  UI_FONT_KEY,
  UI_FONT_CHANGED,
  fontStack,
  normalizeFont,
  createFontReader,
} from "../uiFont";
import { recordRuntimeLog } from "../components/runtimeLogging";

function cachedFont() {
  try {
    return normalizeFont(localStorage.getItem(UI_FONT_KEY));
  } catch {
    return "";
  }
}

export function useUiFont() {
  const [font, setFont] = useState(cachedFont);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    const reader = createFontReader((next) => {
      setFont(next);
      setError(null);
      try {
        localStorage.setItem(UI_FONT_KEY, next);
      } catch (error) {
        recordRuntimeLog("settings", `字体缓存写入失败：${String(error)}`, "warn");
      }
    });
    setLoading(true);
    const read = () => reader.read(() => invokeCommand("get_ui_font"));
    const refresh = () => {
      void read().catch((error) => {
        if (!disposed) setError(String(error));
      });
    };
    window.addEventListener("focus", refresh);
    void (async () => {
      const unlisten = await listen<string>(UI_FONT_CHANGED, ({ payload }) =>
        reader.receive(payload),
      );
      if (disposed) {
        unlisten();
        return;
      }
      off = unlisten;
      await read();
    })()
      .catch((error) => {
        if (!disposed) {
          setError(`读取界面字体失败：${String(error)}`);
          recordRuntimeLog("settings", `读取界面字体失败：${String(error)}`, "error");
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      reader.dispose();
      off?.();
      window.removeEventListener("focus", refresh);
    };
  }, [attempt]);
  const family = fontStack(font);
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--app-font-family", family);
    document.body.style.fontFamily = family;
  }, [family]);
  return { font, family, error, loading, retry };
}
