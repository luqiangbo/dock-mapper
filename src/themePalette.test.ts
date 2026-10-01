import { describe, expect, it, vi } from "vitest";
import {
  accentColors,
  applyTheme,
  DEFAULT_ACCENT_COLOR,
  parseAccent,
  parseThemeMode,
  resolveTheme,
  themePalettes,
} from "./themePalette";

describe("主题颜色", () => {
  it("切换主题后，页面变量使用与组件主题相同的颜色", () => {
    const properties = new Map<string, string>();
    const root = {
      dataset: {} as { theme?: string },
      style: {
        colorScheme: "",
        setProperty: (key: string, value: string) => properties.set(key, value),
      },
    };
    vi.stubGlobal("document", {
      documentElement: root,
      body: { setAttribute: vi.fn(), removeAttribute: vi.fn() },
    });
    try {
      applyTheme("dark", "#8878d8");
      expect(properties.get("--surface-base")).toBe(themePalettes.dark["surface-base"]);
      applyTheme("light", "#8878d8");
      expect(root.dataset.theme).toBe("light");
      expect(properties.get("--surface-base")).toBe(themePalettes.light["surface-base"]);
      expect(properties.get("--text-primary")).toBe(themePalettes.light["text-primary"]);
      expect(properties.get("--accent-ink")).toBe(accentColors("#8878d8", "light").foreground);
      expect(properties.get("--accent-soft")).toBe(accentColors("#8878d8", "light").soft);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("未设置主题色时使用灰蓝色，已经保存的自定义颜色保持不变", () => {
    expect(parseAccent(null)).toBe(DEFAULT_ACCENT_COLOR);
    expect(parseAccent("invalid")).toBe(DEFAULT_ACCENT_COLOR);
    expect(parseAccent("#8878d8")).toBe("#8878d8");
    expect(accentColors("#8878d8", "dark").solid).toBe("#8878d8");
  });
  it("浅深主题使用同色系的可读文字，不改写按钮色", () => {
    expect(accentColors("#526d87", "light").foreground).toBe("#526d87");
    expect(accentColors("#526d87", "dark").foreground).not.toBe("#526d87");
    expect(accentColors("#000000", "dark").foreground).not.toBe("#000000");
    expect(accentColors("#ffffff", "light").foreground).not.toBe("#ffffff");
    expect(accentColors("#526d87", "dark").soft).toBe("rgb(82 109 135 / 18%)");
  });
  it("手动浅色覆盖系统深色，切回系统后跟随系统", () => {
    expect(resolveTheme(parseThemeMode("light"), true)).toBe("light");
    expect(resolveTheme(parseThemeMode("system"), true)).toBe("dark");
    expect(resolveTheme(parseThemeMode("invalid"), false)).toBe("light");
  });
  it("组件主题颜色可被颜色计算直接解析，浅色面板不使用深色底", () => {
    for (const palette of Object.values(themePalettes))
      for (const value of Object.values(palette)) expect(value).not.toContain("var(");
    expect(themePalettes.light["surface-base"]).toBe("#ffffff");
    expect(themePalettes.light["surface-muted"]).toBe("#edf0f4");
    expect(themePalettes.dark["surface-base"]).toBe("#292d33");
  });
});
