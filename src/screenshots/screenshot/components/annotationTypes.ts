import type { ScreenshotConfig } from "../../../types";

export type ArrowPreset = "straight" | "zigzag" | "double" | "lightning";
export type ArrowStyle = ArrowPreset
  | "loop" | "sweep" | "curve" | "block"
  // Kept only for in-memory compatibility with an annotation being edited
  // while the toolbar code hot-reloads. It is no longer exposed as a preset.
  | "label";
export const ARROW_STYLE_OPTIONS: ReadonlyArray<{ value: ArrowPreset; label: string }> = [
  { value: "straight", label: "直线" },
  { value: "zigzag", label: "折线" },
  { value: "double", label: "双箭头" },
  { value: "lightning", label: "闪电" },
];
export const ARROW_WIDTHS = [8, 12, 18] as const;
export const DEFAULT_ARROW_WIDTH = 12;
export function normalizeArrowStyle(style: ArrowStyle): ArrowPreset {
  return style === "zigzag" || style === "double" || style === "lightning" ? style : "straight";
}
/** Resized arrows carry any width; the toolbar shows the closest offered step. */
export function normalizeArrowWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_ARROW_WIDTH;
  return ARROW_WIDTHS.reduce((closest, value) =>
    Math.abs(value - width) < Math.abs(closest - width) ? value : closest,
  );
}
export type TextFont = "sans" | "serif" | "mono";
export type FrameEffect =
  | "classic"
  | "crayon"
  | "handdrawn"
  | "watercolor"
  | "ink"
  | "cartoon"
  | "gradient"
  | "decorative";
export type ArrowEffect = "classic" | "crayon" | "marker" | "gradient";
export const DEFAULT_ARROW_EFFECT: ArrowEffect = "classic";
export const ARROW_EFFECT_OPTIONS: ReadonlyArray<{ value: ArrowEffect; label: string }> = [
  { value: "classic", label: "纯色" },
  { value: "crayon", label: "蜡笔" },
  { value: "marker", label: "马克笔" },
  { value: "gradient", label: "渐变" },
];
/** Accept old in-memory values during development; no annotation documents are stored. */
export function normalizeArrowEffect(effect?: string): ArrowEffect {
  if (effect === "gradient" || effect === "marker" || effect === "crayon") return effect;
  if (effect === "ink" || effect === "handdrawn") return "crayon";
  if (effect === "watercolor") return "marker";
  return DEFAULT_ARROW_EFFECT;
}
export const DEFAULT_FRAME_EFFECT: FrameEffect = "classic";
export const FRAME_EFFECT_OPTIONS: ReadonlyArray<{ value: FrameEffect; label: string }> = [
  { value: "classic", label: "经典" },
  { value: "crayon", label: "蜡笔" },
  { value: "handdrawn", label: "手绘" },
  { value: "watercolor", label: "水彩" },
  { value: "ink", label: "填充蜡笔" },
  { value: "cartoon", label: "卡通" },
  { value: "gradient", label: "渐变笔锋" },
  { value: "decorative", label: "装饰" },
];
export type FrameShape = "rect" | "ellipse";
export const FRAME_SHAPE_OPTIONS: ReadonlyArray<{ value: FrameShape; label: string }> = [
  { value: "rect", label: "矩形" },
  { value: "ellipse", label: "圆形" },
];

export interface TextStyle {
  fontSize: number;
  color: string;
  font: TextFont;
  bold: boolean;
  strokeColor: string;
  strokeWidth: number;
}

export interface NumberStyle {
  backgroundColor: string;
  textColor: string;
  size: number;
}

export interface GradientStop {
  offset: number;
  color: string;
}

export interface ToolSettings {
  strokeColor: string;
  gradientStops?: GradientStop[] | null;
  strokeWidth: number;
  fillOpacity: number;
  shapeKind: FrameShape;
  shapeEffect?: FrameEffect;
  arrowWidth: number;
  arrowStyle: ArrowStyle;
  arrowEffect?: ArrowEffect;
  arrowHeadSize: number;
  penWidth: number;
  highlightWidth: number;
  highlightOpacity: number;
  mosaicBlock: number;
  pickerFormat: ScreenshotConfig["color_copy_format"];
  textStyle: TextStyle;
  numberStyle: NumberStyle;
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontSize: 24,
  color: "#ffffff",
  font: "sans",
  bold: false,
  strokeColor: "#000000",
  strokeWidth: 0,
};
export const DEFAULT_NUMBER_STYLE: NumberStyle = {
  backgroundColor: "#ef4444",
  textColor: "#ffffff",
  size: 32,
};
