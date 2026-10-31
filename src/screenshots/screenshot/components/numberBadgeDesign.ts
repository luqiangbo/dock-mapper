import type { NumberStyle } from "./annotationTypes";

// Legacy palette fields remain readable; all new badges use the saved colors.
export function numberBadgeDesign(style: NumberStyle, _value: number) {
  return { appearance: "flat" as const, fill: style.backgroundColor, text: style.textColor };
}
