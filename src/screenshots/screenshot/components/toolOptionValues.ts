export function selectNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
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
