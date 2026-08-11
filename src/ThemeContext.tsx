import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ThemeMode } from "./types";

const THEME_KEY = "dock-mapper:theme";
const ACCENT_COLOR_KEY = "dock-mapper:accent-color";
const DEFAULT_ACCENT_COLOR = "#8878d8";
const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: "light" | "dark";
  accentColor: string;
  setMode: (mode: ThemeMode) => void;
  setAccentColor: (color: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function loadMode(): ThemeMode {
  const value = localStorage.getItem(THEME_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function loadAccentColor(): string {
  const value = localStorage.getItem(ACCENT_COLOR_KEY);
  return value && isHexColor(value) ? value : DEFAULT_ACCENT_COLOR;
}

function toAccentSoft(color: string): string {
  const value = color.slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgb(${red} ${green} ${blue} / 12%)`;
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [mode, setModeState] = useState<ThemeMode>(loadMode);
  const [accentColor, setAccentColorState] = useState(loadAccentColor);
  const [systemDark, setSystemDark] = useState(darkMedia.matches);
  const resolved = mode === "system" ? (systemDark ? "dark" : "light") : mode;

  useEffect(() => {
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    darkMedia.addEventListener("change", onChange);
    return () => darkMedia.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.setProperty("--accent", accentColor);
    document.documentElement.style.setProperty("--accent-soft", toAccentSoft(accentColor));
    document.documentElement.style.setProperty("--button-accent", accentColor);
    if (resolved === "dark") {
      document.body.setAttribute("theme-mode", "dark");
    } else {
      document.body.removeAttribute("theme-mode");
    }
    void getCurrentWindow().setTheme(resolved);
  }, [accentColor, resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolved,
      accentColor,
      setMode: (next) => {
        localStorage.setItem(THEME_KEY, next);
        setModeState(next);
      },
      setAccentColor: (next) => {
        const value = isHexColor(next) ? next : DEFAULT_ACCENT_COLOR;
        localStorage.setItem(ACCENT_COLOR_KEY, value);
        setAccentColorState(value);
      },
    }),
    [accentColor, mode, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme 必须在 ThemeProvider 内使用");
  return context;
}
