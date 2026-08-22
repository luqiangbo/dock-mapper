import type { TextStyle } from "./annotationTypes";

export const TEXT_SIZES = [14, 16, 20, 24, 32, 40, 48] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export interface TextEditorState extends TextStyle {
  id?: string;
  canvasX: number;
  canvasY: number;
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
}

export interface TextObject extends TextStyle {
  id: string;
  text: string;
  canvasX: number;
  canvasY: number;
  width: number;
  height: number;
  scale: number;
}

const FONT_FAMILIES: Record<TextStyle["font"], string> = {
  sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Consolas, monospace",
};

export function fontFamily(font: TextStyle["font"]): string {
  return FONT_FAMILIES[font];
}
