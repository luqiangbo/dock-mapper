export const UI_FONT_KEY = "dock-mapper:ui-font";
export const UI_FONT_CHANGED = "ui-font-changed";
export const DEFAULT_FONT_STACK =
  '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif';

export function normalizeFont(value: unknown): string {
  if (typeof value !== "string") return "";
  const font = value.trim();
  return font.length <= 128 && !/["'\\;{}\r\n\x00-\x1f]/.test(font) ? font : "";
}

export function fontStack(font: string): string {
  const name = normalizeFont(font);
  return name ? `"${name}", ${DEFAULT_FONT_STACK}` : DEFAULT_FONT_STACK;
}

export function fontOptions(fonts: string[], selected: string) {
  const options = [
    { value: "", label: "跟随系统（默认）" },
    ...fonts.map((font) => ({
      value: font,
      label: font,
    })),
  ];
  if (selected && !fonts.includes(selected))
    options.push({ value: selected, label: `${selected}（不可用，使用回退字体）` });
  return options;
}

/** Coordinates native reads and events; an older read must not replace a newer event. */
export function createFontReader(apply: (font: string) => void) {
  let revision = 0;
  let disposed = false;
  return {
    receive(font: string) {
      if (disposed) return;
      revision += 1;
      apply(normalizeFont(font));
    },
    async read(load: () => Promise<string>) {
      const expected = ++revision;
      try {
        const font = await load();
        if (!disposed && revision === expected) apply(normalizeFont(font));
      } catch (error) {
        // Only an obsolete read is ignored; current failures remain visible/retryable.
        if (!disposed && revision === expected) throw error;
      }
    },
    dispose() {
      disposed = true;
      revision += 1;
    },
  };
}
