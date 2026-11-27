import type { OcrResult } from "../../../api/screenshotTypes";
import type { TranslationBlock } from "../../../api/translation";

export const TRANSLATION_FONT = '"Microsoft YaHei", "Yu Gothic", "Malgun Gothic", sans-serif';
import { layoutTranslationText, type TranslationTextLayout } from "./translationTextLayout";
export { fitTranslationText } from "./translationTextLayout";
export type { TranslationTextLayout } from "./translationTextLayout";
export interface TranslationAppearance {
  canvas: HTMLCanvasElement;
  result: OcrResult;
  layouts: TranslationTextLayout[];
}

export interface SampledTranslationStyle {
  background: string;
  color: string;
  fontWeight: number;
  inkRect: { x: number; y: number; width: number; height: number } | null;
}

function relativeLuminance(r: number, g: number, b: number) {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: readonly number[], b: readonly number[]) {
  const l1 = relativeLuminance(a[0], a[1], a[2]);
  const l2 = relativeLuminance(b[0], b[1], b[2]);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function sampleBorderRgb(
  image: { width: number; height: number; data: ArrayLike<number> },
  rect: { x: number; y: number; width: number; height: number },
): [number, number, number] {
  const samples: number[][] = [[], [], []];
  const sample = (x: number, y: number) => {
    x = Math.max(0, Math.min(image.width - 1, Math.round(x)));
    y = Math.max(0, Math.min(image.height - 1, Math.round(y)));
    const offset = (y * image.width + x) * 4;
    for (let channel = 0; channel < 3; channel++)
      samples[channel].push(image.data[offset + channel]);
  };
  for (let i = 0; i <= 24; i++) {
    sample(rect.x + (rect.width * i) / 24, rect.y - 2);
    sample(rect.x + (rect.width * i) / 24, rect.y + rect.height + 2);
    sample(rect.x - 2, rect.y + (rect.height * i) / 24);
    sample(rect.x + rect.width + 2, rect.y + (rect.height * i) / 24);
  }
  return samples.map(
    (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)],
  ) as [number, number, number];
}

export function sampleTranslationBackground(
  image: { width: number; height: number; data: ArrayLike<number> },
  rect: { x: number; y: number; width: number; height: number },
) {
  const rgb = sampleBorderRgb(image, rect);
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return { background: `rgb(${rgb.join(", ")})`, color: luminance > 140 ? "#171717" : "#ffffff" };
}

export function sampleTranslationStyle(
  image: { width: number; height: number; data: ArrayLike<number> },
  rect: { x: number; y: number; width: number; height: number },
): SampledTranslationStyle {
  const bg = sampleBorderRgb(image, rect);
  const bgLuminance = bg[0] * 0.2126 + bg[1] * 0.7152 + bg[2] * 0.0722;
  const fallbackRgb: [number, number, number] = bgLuminance > 140 ? [23, 23, 23] : [255, 255, 255];
  const fallbackColor = bgLuminance > 140 ? "#171717" : "#ffffff";
  const background = `rgb(${bg.join(", ")})`;

  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(image.width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(image.height, Math.ceil(rect.y + rect.height));
  const spanW = x1 - x0;
  const spanH = y1 - y0;
  if (spanW < 2 || spanH < 2) {
    return { background, color: fallbackColor, fontWeight: 400, inkRect: null };
  }

  const stride = spanW * spanH > 20_000 ? 2 : 1;
  let maxDist = 0;
  for (let y = y0; y < y1; y += stride) {
    for (let x = x0; x < x1; x += stride) {
      const offset = (y * image.width + x) * 4;
      const dist = Math.hypot(
        image.data[offset] - bg[0],
        image.data[offset + 1] - bg[1],
        image.data[offset + 2] - bg[2],
      );
      if (dist > maxDist) maxDist = dist;
    }
  }
  if (maxDist < 36) {
    return { background, color: fallbackColor, fontWeight: 400, inkRect: null };
  }

  const inkThreshold = Math.max(28, maxDist * 0.38);
  const colorThreshold = Math.max(40, maxDist * 0.65);
  let minX = x1;
  let maxX = x0;
  let minY = y1;
  let maxY = y0;
  let inkSamples = 0;
  const fgChannels: [number[], number[], number[]] = [[], [], []];

  for (let y = y0; y < y1; y += stride) {
    for (let x = x0; x < x1; x += stride) {
      const offset = (y * image.width + x) * 4;
      const r = image.data[offset];
      const g = image.data[offset + 1];
      const b = image.data[offset + 2];
      const dist = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
      if (dist >= inkThreshold) {
        inkSamples += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (dist >= colorThreshold) {
          fgChannels[0].push(r);
          fgChannels[1].push(g);
          fgChannels[2].push(b);
        }
      }
    }
  }

  const inkWidth = maxX - minX + stride;
  const inkHeight = maxY - minY + stride;
  const inkRect =
    inkSamples > 0 && inkWidth >= 2 && inkHeight >= 2
      ? { x: minX, y: minY, width: Math.min(rect.width, inkWidth), height: Math.min(rect.height, inkHeight) }
      : null;

  let color = fallbackColor;
  if (fgChannels[0].length > 0) {
    const fgRgb = fgChannels.map(
      (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)],
    ) as [number, number, number];
    if (contrastRatio(fgRgb, bg) >= 2.6) {
      color = `rgb(${fgRgb.join(", ")})`;
    } else {
      const blended = fgRgb.map((channel, index) =>
        Math.round(channel * 0.5 + fallbackRgb[index] * 0.5),
      );
      color =
        contrastRatio(blended, bg) >= 2.6 ? `rgb(${blended.join(", ")})` : fallbackColor;
    }
  }

  const inkArea = inkRect ? (inkRect.width * inkRect.height) / (stride * stride) : 0;
  const fillRatio = inkArea > 0 ? inkSamples / inkArea : 0;
  const fontWeight = fillRatio >= 0.42 && (inkRect?.height ?? 0) >= 10 ? 600 : 400;

  return { background, color, fontWeight, inkRect };
}

export function buildTranslationAppearance(
  base: HTMLCanvasElement,
  original: OcrResult,
  translated: TranslationBlock[],
): TranslationAppearance {
  const translations = new Map(translated.map((block) => [block.id, block.text]));
  const canvas = document.createElement("canvas");
  canvas.width = base.width;
  canvas.height = base.height;
  const context = canvas.getContext("2d");
  const source = base.getContext("2d");
  if (!context || !source) throw new Error("译文画布不可用，请重试");
  const pixels = source.getImageData(0, 0, base.width, base.height);
  context.drawImage(base, 0, 0);
  const layouts: TranslationTextLayout[] = [];
  const blocks: OcrResult["blocks"] = [];
  const masks: Array<{ x: number; y: number; width: number; height: number; background: string }> =
    [];
  original.blocks.forEach((block, id) => {
    if (!block.text.trim()) return;
    const text = translations.get(id);
    if (!text?.trim()) throw new Error("译文文字块不完整，请重试");
    const x = Math.max(0, Math.min(base.width, block.x));
    const y = Math.max(0, Math.min(base.height, block.y));
    const width = Math.min(base.width - x, block.width);
    const height = Math.min(base.height - y, block.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
      throw new Error("OCR 文字坐标无效，请重新识别");
    const style = sampleTranslationStyle(pixels, { x, y, width, height });
    const weight = style.fontWeight;
    const measure = (value: string, size: number) => {
      context.font = `${weight} ${size}px ${TRANSLATION_FONT}`;
      return context.measureText(value).width;
    };
    const layout: TranslationTextLayout = {
      ...layoutTranslationText(
        block.text,
        text,
        { x, y, width, height },
        measure,
        (value, size) => {
          context.font = `${weight} ${size}px ${TRANSLATION_FONT}`;
          const metrics = context.measureText(value);
          return {
            ascent: metrics.actualBoundingBoxAscent,
            descent: metrics.actualBoundingBoxDescent,
            fontAscent: metrics.fontBoundingBoxAscent ?? size * 0.8,
            fontDescent: metrics.fontBoundingBoxDescent ?? size * 0.2,
          };
        },
        { inkRect: style.inkRect, fontWeight: weight },
      ),
      color: style.color,
    };
    layouts.push(layout);
    blocks.push({
      ...block,
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
      text: layout.lines.join("\n"),
    });
    masks.push({ x, y, width, height, background: style.background });
  });
  // Paint every mask before any text, so adjacent OCR boxes cannot erase a
  // translated neighbor. This canvas is immutable after publication.
  for (const mask of masks) {
    context.fillStyle = mask.background;
    context.fillRect(mask.x, mask.y, mask.width, mask.height);
  }
  for (const layout of layouts) {
    context.save();
    context.beginPath();
    context.rect(layout.x, layout.y, layout.width, layout.height);
    context.clip();
    context.font = `${layout.fontWeight ?? 400} ${layout.fontSize}px ${TRANSLATION_FONT}`;
    context.fillStyle = layout.color;
    context.textBaseline = "alphabetic";
    layout.lines.forEach((line, index) =>
      context.fillText(line, layout.x, layout.y + layout.baseline + index * layout.lineHeight),
    );
    context.restore();
  }
  return {
    canvas,
    layouts,
    result: { ...original, blocks, text: blocks.map((block) => block.text).join("\n") },
  };
}

export function translationExportBackground(
  original: HTMLCanvasElement | null,
  translated: TranslationAppearance | null,
  visible: boolean,
) {
  return visible && translated ? translated.canvas : original;
}
