import type { ScreenshotConfig } from "../../../types";

export type ColorCopyFormat = ScreenshotConfig["color_copy_format"];

export interface PickerSample {
  hex: string;
  red: number;
  green: number;
  blue: number;
  imageX: number;
  imageY: number;
  left: number;
  top: number;
}

function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(lightness * 100)];
  const delta = max - min;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return [
    Math.round((hue * 60 + 360) % 360),
    Math.round(saturation * 100),
    Math.round(lightness * 100),
  ];
}

function rgbToHsv(red: number, green: number, blue: number): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  return [
    Math.round((hue * 60 + 360) % 360),
    Math.round((max ? delta / max : 0) * 100),
    Math.round(max * 100),
  ];
}

export function formatPickerColor(
  sample: Pick<PickerSample, "hex" | "red" | "green" | "blue">,
  format: ColorCopyFormat,
): string {
  const { red, green, blue } = sample;
  if (format === "hex") return `#${sample.hex}`;
  if (format === "rgb") return `rgb(${red}, ${green}, ${blue})`;
  if (format === "css")
    return `color(srgb ${Math.round((red / 255) * 100)}% ${Math.round((green / 255) * 100)}% ${Math.round((blue / 255) * 100)}%)`;
  if (format === "hsl") {
    const [hue, saturation, lightness] = rgbToHsl(red, green, blue);
    return `hsl(${hue} ${saturation}% ${lightness}%)`;
  }
  const [hue, saturation, value] = rgbToHsv(red, green, blue);
  return `hsv(${hue} ${saturation}% ${value}%)`;
}

export function formatPaletteColor(color: string, format: ColorCopyFormat): string {
  const hex = color.replace(/^#/, "").toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(hex)) throw new Error("颜色必须为 #RRGGBB");
  return formatPickerColor(
    {
      hex,
      red: parseInt(hex.slice(0, 2), 16),
      green: parseInt(hex.slice(2, 4), 16),
      blue: parseInt(hex.slice(4, 6), 16),
    },
    format,
  );
}
