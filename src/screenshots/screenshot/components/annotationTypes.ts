import type { ScreenshotConfig } from "../../../types";
import type { ArrowBrushId } from "./arrowBrushPresets";

export type ArrowPreset = "straight" | "segmented" | "double";
export type ArrowStyle = ArrowPreset
  | "zigzag" | "loop" | "sweep" | "curve" | "block" | "lightning"
  // Kept only for in-memory compatibility with an annotation being edited
  // while the toolbar code hot-reloads. It is no longer exposed as a preset.
  | "label";
export const ARROW_STYLE_OPTIONS: ReadonlyArray<{ value: ArrowPreset; label: string }> = [
  { value: "straight", label: "单箭头" },
  { value: "segmented", label: "分段箭头" },
  { value: "double", label: "双箭头" },
];
export function normalizeArrowStyle(style: ArrowStyle): ArrowPreset {
  return style === "segmented" || style === "double" ? style : "straight";
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
export const DEFAULT_FRAME_EFFECT: FrameEffect = "classic";
export const FRAME_EFFECT_OPTIONS: ReadonlyArray<{ value: FrameEffect; label: string }> = [
  { value: "classic", label: "经典" },
  { value: "crayon", label: "蜡笔" },
  { value: "handdrawn", label: "Rough 手绘" },
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
  arrowStyle: ArrowStyle;
  arrowBrushId: ArrowBrushId;
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
