import { createContext, useContext, useEffect, useMemo, type PropsWithChildren } from "react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ThemeMode } from "./types";
import { useWindowTheme } from "./hooks/useWindowTheme";
import { THEME_KEY, ACCENT_COLOR_KEY, THEME_CHANGED, parseAccent } from "./themePalette";
interface ThemeContextValue {
  mode: ThemeMode;
  resolved: "light" | "dark";
  accentColor: string;
  setMode: (mode: ThemeMode) => void;
  setAccentColor: (color: string) => void;
}
const ThemeContext = createContext<ThemeContextValue | null>(null);
function notifyTheme() {
  window.dispatchEvent(new Event(THEME_CHANGED));
  void emit(THEME_CHANGED).catch((error) => console.error("主题同步失败", error));
}
export function ThemeProvider({ children }: PropsWithChildren) {
  const state = useWindowTheme();
  useEffect(() => {
    void getCurrentWindow()
      .setTheme(state.resolved)
      .catch((error) => console.error("原生窗口主题设置失败", error));
  }, [state.resolved]);
  const value = useMemo<ThemeContextValue>(
    () => ({
      ...state,
      setMode: (mode) => {
        localStorage.setItem(THEME_KEY, mode);
        notifyTheme();
      },
      setAccentColor: (color) => {
        localStorage.setItem(ACCENT_COLOR_KEY, parseAccent(color));
        notifyTheme();
      },
    }),
    [state.mode, state.resolved, state.accentColor],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme 必须在 ThemeProvider 内使用");
  return context;
}
