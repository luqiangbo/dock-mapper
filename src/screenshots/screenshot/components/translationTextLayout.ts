export interface TranslationTextLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontWeight?: number;
  lineHeight: number;
  /** Alphabetic baseline measured from the first line box's top. */
  baseline: number;
  /** Shift the DOM line box so its baseline matches the painted glyphs. */
  selectionOffsetY: number;
  lines: string[];
  color: string;
}

export interface TranslationLayoutOptions {
  inkRect?: { x: number; y: number; width: number; height: number } | null;
  fontWeight?: number;
}

type Measure = (text: string, size: number) => number;
type Metrics = (
  text: string,
  size: number,
) => {
  ascent: number;
  descent: number;
  fontAscent: number;
  fontDescent: number;
};

// WebView2 provides Unicode grapheme segmentation; keep local typing compatible
// with the project's ES2020 library instead of changing its compiler target.
const segmenter = new (
  Intl as unknown as {
    Segmenter: new (
      locale: string,
      options: { granularity: "grapheme" },
    ) => {
      segment: (text: string) => Iterable<{ segment: string }>;
    };
  }
).Segmenter("und", { granularity: "grapheme" });
const graphemes = (text: string) => Array.from(segmenter.segment(text), (item) => item.segment);
const latin = /^[\p{Script=Latin}\p{N}\p{M}'’\-]+$/u;
const opening = /^[（([{「『【《〈“‘]$/u;
const closing = /^[，。！？；：、）)\]}」』】》〉”’.,!?;:]$/u;

function unitsForLine(text: string, width: number, size: number, measure: Measure) {
  const tokens: string[] = [];
  let word = "";
  const flush = () => {
    if (!word) return;
    tokens.push(...(measure(word, size) > width ? graphemes(word) : [word]));
    word = "";
  };
  for (const character of graphemes(text)) {
    if (latin.test(character)) word += character;
    else {
      flush();
      tokens.push(character);
    }
  }
  flush();
  const units: string[] = [];
  let prefix = "";
  for (const token of tokens) {
    if (opening.test(token) || (prefix && /^\s+$/u.test(token))) prefix += token;
    else if (closing.test(token) && units.length && !prefix) {
      // Bind closing punctuation to the preceding non-whitespace unit.
      let trailing = "";
      while (units.length > 1 && /^\s+$/u.test(units[units.length - 1]))
        trailing = units.pop()! + trailing;
      units[units.length - 1] += trailing + token;
    } else {
      units.push(prefix + token);
      prefix = "";
    }
  }
  if (prefix) {
    if (units.length) units[units.length - 1] += prefix;
    else units.push(prefix);
  }
  return units;
}

export function wrapTranslationText(text: string, width: number, size: number, measure: Measure) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|[\r\n]/)) {
    if (measure(paragraph, size) <= width) {
      lines.push(paragraph);
      continue;
    }
    let line = "";
    for (const unit of unitsForLine(paragraph, width, size, measure)) {
      // Preserve copied whitespace without creating an otherwise empty line
      // when the separator after an English word reaches the right edge.
      if (/^\s+$/u.test(unit)) {
        line += unit;
        continue;
      }
      if (line && measure(line + unit, size) > width) {
        lines.push(line);
        line = "";
      }
      line += unit;
    }
    lines.push(line);
  }
  return lines;
}

export function fitTranslationText(
  text: string,
  width: number,
  height: number,
  measure: Measure,
  maxFontSize = height * 0.82,
) {
  if (![width, height, maxFontSize].every((value) => Number.isFinite(value) && value > 0))
    throw new Error("文字区域尺寸无效");
  const fits = (size: number, lines: string[]) =>
    lines.length * size * 1.25 <= height &&
    lines.every((line) => measure(line.trimEnd(), size) <= width);
  let high = Math.min(maxFontSize, height / 1.25);
  // Relative bounds keep high-DPI layout exactly proportional.
  let low = high / 2 ** 20;
  let lines = wrapTranslationText(text, width, low, measure);
  if (!fits(low, lines)) throw new Error("文字区域过小，无法完整显示译文，请缩小翻译范围");
  const preferred = wrapTranslationText(text, width, high, measure);
  if (fits(high, preferred)) return { fontSize: high, lineHeight: high * 1.25, lines: preferred };
  for (let iteration = 0; iteration < 20; iteration++) {
    const size = (low + high) / 2;
    const next = wrapTranslationText(text, width, size, measure);
    if (fits(size, next)) {
      low = size;
      lines = next;
    } else high = size;
  }
  return { fontSize: low, lineHeight: low * 1.25, lines };
}

const cjkScript = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
const latinAscender = /[A-Z0-9bdfhklt]/;
const latinDescender = /[gjpqy]/;

function estimateFontSizeFromInk(
  original: string,
  inkHeight: number,
  rectHeight: number,
): number {
  let factor = 0.82;
  if (cjkScript.test(original)) {
    factor = 0.82;
  } else {
    const hasAscender = latinAscender.test(original);
    const hasDescender = latinDescender.test(original);
    if (hasAscender && hasDescender) factor = 0.92;
    else if (hasAscender) factor = 0.72;
    else if (hasDescender) factor = 0.72;
    else factor = 0.56;
  }
  const estimated = inkHeight / factor;
  const minSize = Math.min(rectHeight * 0.65, inkHeight);
  const maxSize = rectHeight * 0.96;
  return Math.max(minSize, Math.min(maxSize, estimated));
}

export function layoutTranslationText(
  original: string,
  translated: string,
  rect: { x: number; y: number; width: number; height: number },
  measure: Measure,
  metrics?: Metrics,
  options?: TranslationLayoutOptions,
): Omit<TranslationTextLayout, "color"> {
  const ink = options?.inkRect ?? null;
  const fontWeight = options?.fontWeight ?? 400;
  const source = fitTranslationText(original, rect.width, rect.height, measure);
  const padX = ink ? 0 : Math.min(source.fontSize * 0.12, rect.width * 0.05);
  const padY = ink ? 0 : Math.min(source.fontSize * 0.08, rect.height * 0.05);
  const horizontalLeft = ink ? Math.max(rect.x, ink.x) : rect.x + padX;
  const availableWidth = Math.max(
    1,
    ink ? rect.x + rect.width - horizontalLeft : rect.width - padX * 2,
  );
  const targetMaxSize = ink
    ? estimateFontSizeFromInk(original, ink.height, rect.height)
    : source.fontSize;
  const singleLineBudget = Math.max(rect.height - padY * 2, targetMaxSize * 1.25);
  const singleTry = fitTranslationText(
    translated,
    availableWidth,
    singleLineBudget,
    measure,
    targetMaxSize,
  );
  const fit =
    singleTry.lines.length === 1 && singleTry.fontSize <= rect.height
      ? singleTry
      : fitTranslationText(
          translated,
          availableWidth,
          Math.max(1, rect.height - padY * 2),
          measure,
          targetMaxSize,
        );
  const height = fit.lines.length * fit.lineHeight;
  const values = fit.lines.filter(Boolean).map((line) => metrics?.(line, fit.fontSize));
  const ascent = Math.max(fit.fontSize * 0.8, ...values.map((value) => value?.ascent ?? 0));
  const descent = Math.max(fit.fontSize * 0.2, ...values.map((value) => value?.descent ?? 0));
  const font = metrics?.("国Ag", fit.fontSize);
  const fontAscent = font?.fontAscent ?? fit.fontSize * 0.8;
  const fontDescent = font?.fontDescent ?? fit.fontSize * 0.2;
  const naturalBaseline = (fit.lineHeight - fontAscent - fontDescent) / 2 + fontAscent;
  const baseline = Math.max(ascent, Math.min(fit.lineHeight - descent, naturalBaseline));

  let x = horizontalLeft;
  let width = availableWidth;
  if (ink && fit.lines.length === 1) {
    const leftMargin = ink.x - rect.x;
    const rightMargin = rect.x + rect.width - (ink.x + ink.width);
    const centeredInBox =
      leftMargin > rect.width * 0.12 &&
      rightMargin > rect.width * 0.12 &&
      Math.abs(leftMargin - rightMargin) <= Math.max(leftMargin, rightMargin) * 0.25;
    if (centeredInBox) {
      const lineWidth = measure(fit.lines[0].trimEnd(), fit.fontSize);
      const inkCenterX = ink.x + ink.width / 2;
      const centeredX = inkCenterX - lineWidth / 2;
      x = Math.max(rect.x, Math.min(rect.x + rect.width - lineWidth, centeredX));
      width = Math.max(1, rect.x + rect.width - x);
    }
  }

  let y: number;
  if (fit.lines.length === 1) {
    if (ink) {
      const inkCenterY = ink.y + ink.height / 2;
      const glyphCenterOffset = baseline - (ascent - descent) / 2;
      y = inkCenterY - glyphCenterOffset;
    } else {
      y = rect.y + (rect.height - height) / 2;
    }
  } else {
    y = rect.y + padY;
  }

  return {
    ...fit,
    fontWeight,
    x,
    y,
    width,
    height,
    baseline,
    selectionOffsetY: baseline - naturalBaseline,
  };
}
