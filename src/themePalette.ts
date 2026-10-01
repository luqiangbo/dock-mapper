import type { ThemeMode } from "./types";

export const THEME_KEY = "dock-mapper:theme";
export const ACCENT_COLOR_KEY = "dock-mapper:accent-color";
export const DEFAULT_ACCENT_COLOR = "#526d87";
export const THEME_CHANGED = "app-theme-changed";

export const themePalettes = {
  light: {
    "app-surface": "rgb(243 245 247 / 88%)",
    "glass-panel": "rgb(255 255 255 / 78%)",
    "glass-surface": "#ffffff",
    "glass-control": "#ffffff",
    "glass-border": "#dce1e7",
    "glass-control-hover": "#f3f5f7",
    "glass-control-active": "#e8edf3",
    "text-primary": "#20252b",
    "text-secondary": "#59636f",
    "text-tertiary": "#737d89",
    "surface-base": "#ffffff",
    "surface-muted": "#edf0f4",
    danger: "#c42b3b",
    "status-success": "#168653",
    "status-muted": "#737d89",
    warning: "#ad6500",
    "warning-soft": "#fff6e7",
    "preview-surface": "rgb(243 245 247 / 68%)",
    "chart-secondary": "#65877e",
    "chart-warm": "#9b794d",
  },
  dark: {
    "app-surface": "rgb(32 35 40 / 92%)",
    "glass-panel": "rgb(41 45 51 / 82%)",
    "glass-surface": "#292d33",
    "glass-control": "#30353c",
    "glass-border": "#414750",
    "glass-control-hover": "#383e47",
    "glass-control-active": "#444c58",
    "text-primary": "#f0f2f5",
    "text-secondary": "#b6bdc7",
    "text-tertiary": "#969fab",
    "surface-base": "#292d33",
    "surface-muted": "#343a43",
    danger: "#ff858b",
    "status-success": "#66c99a",
    "status-muted": "#969fab",
    warning: "#f0b464",
    "warning-soft": "#3a3126",
    "preview-surface": "rgb(32 35 40 / 68%)",
    "chart-secondary": "#94b5a9",
    "chart-warm": "#c7a779",
  },
} as const;

export function parseThemeMode(value: string | null): ThemeMode {
  return value === "dark" || value === "light" ? value : "system";
}
export function parseAccent(value: string | null) {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : DEFAULT_ACCENT_COLOR;
}
export function resolveTheme(mode: ThemeMode, systemDark: boolean): "light" | "dark" {
  return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}

function luminance(channels: number[]) {
  const values = channels.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

/** Keep the saved button color; derive a legible ink from the same hue. */
export function accentColors(accent: string, resolved: "light" | "dark") {
  const solid = parseAccent(accent);
  const channels = [1, 3, 5].map((index) => parseInt(solid.slice(index, index + 2), 16));
  const background = resolved === "dark" ? [41, 45, 51] : [255, 255, 255];
  const baseLuminance = luminance(background);
  const target = resolved === "dark" ? 255 : 0;
  let ink = channels;
  for (let step = 0; step <= 10; step++) {
    ink = channels.map((channel) => Math.round(channel + ((target - channel) * step) / 10));
    const inkLuminance = luminance(ink);
    const contrast =
      (Math.max(inkLuminance, baseLuminance) + 0.05) /
      (Math.min(inkLuminance, baseLuminance) + 0.05);
    if (contrast >= 4.5) break;
  }
  return {
    solid,
    foreground: `#${ink.map((value) => value.toString(16).padStart(2, "0")).join("")}`,
    soft: `rgb(${channels.join(" ")} / ${resolved === "dark" ? 18 : 10}%)`,
  };
}
export function applyTheme(resolved: "light" | "dark", accent: string) {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  for (const [name, value] of Object.entries(themePalettes[resolved]))
    root.style.setProperty(`--${name}`, value);
  const colors = accentColors(accent, resolved);
  root.style.setProperty("--accent", colors.solid);
  root.style.setProperty("--accent-ink", colors.foreground);
  root.style.setProperty("--button-accent", colors.solid);
  root.style.setProperty("--accent-soft", colors.soft);
  if (resolved === "dark") document.body.setAttribute("theme-mode", "dark");
  else document.body.removeAttribute("theme-mode");
}
