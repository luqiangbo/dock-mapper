import { colorChannels, hslColor, rgbColor } from "./annotationPaint";

/**
 * Palette and pattern selection for rectangle and ellipse frames.  Arrow
 * effects no longer share these values, so frame styling can evolve on its own.
 */
export type DecorativeVariant =
  | "stripes"
  | "dots"
  | "stitches"
  | "color-block"
  | "halftone"
  | "waves"
  | "grid"
  | "scales"
  | "speckles";

export function decorativeVariant(seed: number): DecorativeVariant {
  return (
    [
      "stripes",
      "dots",
      "stitches",
      "color-block",
      "halftone",
      "waves",
      "grid",
      "scales",
      "speckles",
    ] as const
  )[seed % 9];
}

export interface FramePalette {
  base: string;
  accent: string;
  contrast: string;
  dark: string;
  light: string;
}

export function decorativePalette(color: string, seed: number): FramePalette {
  const base = colorChannels(color);
  const rgb = base.map((value) => value / 255);
  const max = Math.max(...rgb),
    min = Math.min(...rgb),
    delta = max - min,
    lightness = (max + min) / 2;
  if (delta < 0.08)
    return {
      base: "#2878d0",
      accent: "#14b8a6",
      contrast: "#f59e0b",
      dark: "#172554",
      light: "#ffffff",
    };
  const hue =
    (max === rgb[0]
      ? (rgb[1] - rgb[2]) / delta
      : max === rgb[1]
        ? (rgb[2] - rgb[0]) / delta + 2
        : (rgb[0] - rgb[1]) / delta + 4) * 60;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const direction = seed & 1 ? 1 : -1;
  return {
    base: color,
    accent: hslColor(
      hue + direction * 42,
      Math.max(0.62, saturation),
      Math.max(0.45, Math.min(0.62, lightness)),
    ),
    contrast: hslColor(hue + direction * 175, Math.max(0.72, saturation), 0.55),
    dark: rgbColor(base.map((value) => value * 0.3)),
    light: rgbColor(base.map((value) => value + (255 - value) * 0.88)),
  };
}
