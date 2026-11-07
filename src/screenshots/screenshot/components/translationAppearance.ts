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

export function sampleTranslationBackground(
  image: { width: number; height: number; data: ArrayLike<number> },
  rect: { x: number; y: number; width: number; height: number },
) {
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
  const rgb = samples.map((values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]);
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return { background: `rgb(${rgb.join(", ")})`, color: luminance > 140 ? "#171717" : "#ffffff" };
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
    const colors = sampleTranslationBackground(pixels, { x, y, width, height });
    const measure = (value: string, size: number) => {
      context.font = `400 ${size}px ${TRANSLATION_FONT}`;
      return context.measureText(value).width;
    };
    const layout: TranslationTextLayout = {
      ...layoutTranslationText(
        block.text,
        text,
        { x, y, width, height },
        measure,
        (value, size) => {
          context.font = `400 ${size}px ${TRANSLATION_FONT}`;
          const metrics = context.measureText(value);
          return {
            ascent: metrics.actualBoundingBoxAscent,
            descent: metrics.actualBoundingBoxDescent,
            fontAscent: metrics.fontBoundingBoxAscent ?? size * 0.8,
            fontDescent: metrics.fontBoundingBoxDescent ?? size * 0.2,
          };
        },
      ),
      color: colors.color,
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
    masks.push({ x, y, width, height, background: colors.background });
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
    context.font = `400 ${layout.fontSize}px ${TRANSLATION_FONT}`;
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
