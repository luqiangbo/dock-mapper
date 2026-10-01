import { useEffect, useLayoutEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ACCENT_COLOR_KEY,
  THEME_KEY,
  THEME_CHANGED,
  applyTheme,
  parseAccent,
  parseThemeMode,
  resolveTheme,
} from "../themePalette";

export function useWindowTheme() {
  const read = () => ({
    mode: parseThemeMode(localStorage.getItem(THEME_KEY)),
    accentColor: parseAccent(localStorage.getItem(ACCENT_COLOR_KEY)),
  });
  const [preferences, setPreferences] = useState(read);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const next = read();
      setPreferences((previous) =>
        previous.mode === next.mode && previous.accentColor === next.accentColor ? previous : next,
      );
    };
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_KEY || event.key === ACCENT_COLOR_KEY) update();
    };
    const system = () => setSystemDark(media.matches);
    let disposed = false;
    let off: (() => void) | undefined;
    window.addEventListener("storage", storage);
    window.addEventListener(THEME_CHANGED, update);
    media.addEventListener("change", system);
    void listen(THEME_CHANGED, update)
      .then((unlisten) => {
        if (disposed) unlisten();
        else off = unlisten;
        if (!disposed) update();
      })
      .catch((error) => console.error("主题同步监听失败", error));
    return () => {
      disposed = true;
      off?.();
      window.removeEventListener("storage", storage);
      window.removeEventListener(THEME_CHANGED, update);
      media.removeEventListener("change", system);
    };
  }, []);
  const resolved = resolveTheme(preferences.mode, systemDark);
  useLayoutEffect(
    () => applyTheme(resolved, preferences.accentColor),
    [resolved, preferences.accentColor],
  );
  return { ...preferences, resolved };
}
