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
  transformScale: number;
  containerId?: string | null;
}

export interface TextObject extends TextStyle {
  id: string;
  text: string;
  canvasX: number;
  canvasY: number;
  width: number;
  height: number;
  scale: number;
  transformScale: number;
  angle?: number;
  groupId?: string | null;
  version?: number;
  seed?: number;
  containerId?: string | null;
}

const FONT_FAMILIES: Record<TextStyle["font"], string> = {
  virgil: "'Virgil', 'Xiaolai', cursive",
  helvetica: "Helvetica, 'Liberation Sans', 'Xiaolai', sans-serif",
  cascadia: "'Cascadia Code', 'Xiaolai', monospace",
  excalifont: "'Excalifont', 'Xiaolai', cursive",
  nunito: "'Nunito', 'Xiaolai', sans-serif",
  lilita: "'Lilita One', 'Xiaolai', sans-serif",
  "comic-shanns": "'Comic Shanns', 'Xiaolai', cursive",
  "liberation-sans": "'Liberation Sans', 'Xiaolai', sans-serif",
  sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Consolas, monospace",
};

export function fontFamily(font: TextStyle["font"]): string {
  return FONT_FAMILIES[font];
}
