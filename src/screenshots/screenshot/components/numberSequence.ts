export type NumberSequenceFormat = "decimal" | "alpha" | "roman";
export function formatSequence(value: number, format: NumberSequenceFormat = "decimal"): string {
  let number = Math.max(1, Math.floor(value));
  if (format === "alpha") {
    let text = "";
    while (number > 0) {
      number--;
      text = String.fromCharCode(65 + (number % 26)) + text;
      number = Math.floor(number / 26);
    }
    return text;
  }
  if (format === "roman" && number <= 3999) {
    let text = "";
    for (const [amount, token] of [
      [1000, "M"],
      [900, "CM"],
      [500, "D"],
      [400, "CD"],
      [100, "C"],
      [90, "XC"],
      [50, "L"],
      [40, "XL"],
      [10, "X"],
      [9, "IX"],
      [5, "V"],
      [4, "IV"],
      [1, "I"],
    ] as const) {
      while (number >= amount) {
        text += token;
        number -= amount;
      }
    }
    return text;
  }
  return String(number);
}
