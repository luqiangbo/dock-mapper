export function selectNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

export function defaultOptionValue(name: string): string | number | undefined {
  if (name.endsWith("-width")) return name.startsWith("highlight") ? 24 : 6;
  if (name.endsWith("-opacity")) return name.startsWith("highlight") ? 32 : 100;
  if (name.endsWith("-roughness")) return 2;
  if (name.endsWith("-fill-style")) return "none";
  if (name.endsWith("-line-style")) return "solid";
  if (name === "arrow-start") return "none";
  if (name === "arrow-end") return "arrow";
  if (name === "arrow-style" || name === "rectangle-roundness") return "sharp";
  if (name === "text-font") return "microsoft-yahei";
  if (name === "text-size") return 24;
  if (name === "text-align") return "left";
  if (name === "number-size") return 36;
  if (name === "mosaic-strength") return 12;
  if (name === "mosaic-effect") return "pixelate";
  if (name === "picker-format") return "hex";
  return undefined;
}
export function defaultFirst<T extends { value: string | number }>(
  options: readonly T[],
  defaultValue: string | number | undefined,
): T[] {
  return [
    ...options.filter((option) => option.value === defaultValue),
    ...options.filter((option) => option.value !== defaultValue),
  ];
}

export function normalizeHexColor(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(normalized)) return normalized;
  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    return `#${normalized
      .slice(1)
      .split("")
      .map((part) => part + part)
      .join("")}`;
  }
  return "#000000";
}
