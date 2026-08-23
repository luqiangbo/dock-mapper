export type MeasureTextWidth = (value: string) => number;

export function isTextObjectInteractive(tool: string | null): boolean {
  return tool === "text";
}

function breakOversizedToken(
  token: string,
  maxWidth: number,
  measure: MeasureTextWidth,
): string[] {
  const parts: string[] = [];
  let current = "";
  for (const character of Array.from(token)) {
    if (current && measure(current + character) > maxWidth) {
      parts.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function wrapTextLines(
  text: string,
  maxWidth: number,
  measure: MeasureTextWidth,
): string[] {
  const width = Math.max(1, maxWidth);
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    const tokens = paragraph.match(/\s+|\S+/gu) ?? [];
    let line = "";
    for (const token of tokens) {
      const candidate = line + token;
      if (!line || measure(candidate) <= width) {
        if (measure(candidate) <= width) {
          line = candidate;
          continue;
        }
      }
      if (line.trimEnd()) lines.push(line.trimEnd());
      line = "";
      if (/^\s+$/u.test(token)) continue;
      const parts = breakOversizedToken(token, width, measure);
      lines.push(...parts.slice(0, -1));
      line = parts.length ? parts[parts.length - 1] : "";
    }
    lines.push(line.trimEnd());
  }
  return lines.length ? lines : [""];
}
