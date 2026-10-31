// Five-by-seven glyphs are native rectangles in both preview and exported annotations.
const GLYPHS: Record<string, number[]> = {
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 2, 4, 8, 31],
  "3": [30, 1, 1, 14, 1, 1, 30],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 16, 30, 1, 1, 30],
  "6": [14, 16, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 1, 14],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 14],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 18, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
};
export function numberPixelGlyph(
  label: string,
  center: { x: number; y: number },
  diameter: number,
) {
  const unit = Math.min(
    (diameter * 0.62) / Math.max(5, label.length * 6 - 1),
    (diameter * 0.56) / 7,
  );
  const left = center.x - ((label.length * 6 - 1) * unit) / 2,
    top = center.y - (7 * unit) / 2;
  const cells: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const [index, char] of [...label.toUpperCase()].entries()) {
    const rows = GLYPHS[char] ?? GLYPHS["0"];
    rows.forEach((bits, row) => {
      let start = -1;
      for (let col = 0; col <= 5; col++) {
        const filled = col < 5 && (bits & (1 << (4 - col))) !== 0;
        if (filled && start < 0) start = col;
        if (!filled && start >= 0) {
          cells.push({
            x: left + (index * 6 + start) * unit,
            y: top + row * unit,
            width: (col - start) * unit,
            height: unit,
          });
          start = -1;
        }
      }
    });
  }
  return cells;
}
