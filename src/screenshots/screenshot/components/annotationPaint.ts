import type { GradientStop } from "./annotationTypes";

export function normalizeGradientStops(stops?: GradientStop[] | null): GradientStop[] | undefined {
  if (!stops || stops.length < 2) return undefined;
  const normalized = stops
    .filter((stop) => Number.isFinite(stop.offset) && /^#[0-9a-f]{6}$/i.test(stop.color))
    .map((stop) => ({
      offset: Math.max(0, Math.min(1, stop.offset)),
      color: stop.color.toLowerCase(),
    }))
    .sort((a, b) => a.offset - b.offset)
    .slice(0, 8);
  if (normalized.length < 2) return undefined;
  normalized[0] = { ...normalized[0], offset: 0 };
  normalized[normalized.length - 1] = { ...normalized[normalized.length - 1], offset: 1 };
  return normalized;
}

/** Shared by arrow brushes and frame palettes; unreadable colors fall back. */
export function colorChannels(color: string): [number, number, number] {
  const value = color.replace("#", "");
  const expanded = value.length === 3 ? [...value].map((part) => part + part).join("") : value;
  const rgb = [0, 2, 4].map((index) => Number.parseInt(expanded.slice(index, index + 2), 16));
  return rgb.some((value) => !Number.isFinite(value))
    ? [239, 68, 68]
    : (rgb as [number, number, number]);
}

export function rgbColor(rgb: number[]): string {
  return `rgb(${rgb.map((value) => Math.round(Math.max(0, Math.min(255, value)))).join(", ")})`;
}

export function hslColor(hue: number, saturation: number, lightness: number): string {
  return `hsl(${Math.round((hue + 360) % 360)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%)`;
}

export function samplePaintColor(
  fallback: string,
  stops: GradientStop[] | undefined,
  progress: number,
): string {
  const normalized = normalizeGradientStops(stops);
  if (!normalized) return fallback;
  const t = Math.max(0, Math.min(1, progress));
  const rightIndex = normalized.findIndex((stop) => stop.offset >= t);
  if (rightIndex <= 0) return normalized[0].color;
  const left = normalized[rightIndex - 1];
  const right = normalized[rightIndex];
  const span = right.offset - left.offset || 1;
  const ratio = (t - left.offset) / span;
  const a = colorChannels(left.color);
  const b = colorChannels(right.color);
  return `#${a
    .map((value, index) => Math.round(value + (b[index] - value) * ratio).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function createPaintSampler(
  fallback: string,
  stops?: GradientStop[] | null,
): (progress: number) => string {
  const normalized = normalizeGradientStops(stops);
  return (progress) => {
    if (!normalized) return fallback;
    const t = Math.max(0, Math.min(1, progress));
    const rightIndex = normalized.findIndex((stop) => stop.offset >= t);
    if (rightIndex <= 0) return normalized[0].color;
    const left = normalized[rightIndex - 1];
    const right = normalized[rightIndex];
    const ratio = (t - left.offset) / (right.offset - left.offset || 1);
    const a = colorChannels(left.color),
      b = colorChannels(right.color);
    return `#${a.map((value, index) => Math.round(value + (b[index] - value) * ratio).toString(16).padStart(2, "0")).join("")}`;
  };
}

export function createCanvasPaint(
  context: CanvasRenderingContext2D,
  fallback: string,
  stops: GradientStop[] | undefined,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): string | CanvasGradient {
  const normalized = normalizeGradientStops(stops);
  if (!normalized) return fallback;
  const gradient = context.createLinearGradient(startX, startY, endX, endY);
  normalized.forEach((stop) => gradient.addColorStop(stop.offset, stop.color));
  return gradient;
}

export function paintCacheKey(stops?: GradientStop[] | null): string {
  return JSON.stringify(normalizeGradientStops(stops) ?? []);
}
