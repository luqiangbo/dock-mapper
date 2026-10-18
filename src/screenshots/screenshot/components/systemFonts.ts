import fonts from "./systemFonts.json";
export const SYSTEM_FONTS = fonts;
export const DEFAULT_FONT_FAVORITES = [
  "microsoft-yahei",
  "simsun",
  "simhei",
  "kaiti",
  "arial",
  "segoe-ui",
  "times-new-roman",
  "consolas",
];
export function normalizeFontFavorites(values?: readonly string[]): string[] {
  const known = new Set(fonts.map((font) => font.key));
  const result = [...new Set(values ?? DEFAULT_FONT_FAVORITES)]
    .filter((key) => known.has(key))
    .slice(0, 10);
  return result.length ? result : [...DEFAULT_FONT_FAVORITES];
}
export function systemFontOptions(values?: readonly string[]) {
  return normalizeFontFavorites(values).map((key) => {
    const font = fonts.find((entry) => entry.key === key)!;
    return { value: key, label: font.label };
  });
}
