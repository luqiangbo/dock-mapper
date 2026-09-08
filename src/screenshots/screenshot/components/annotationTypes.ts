import type { ScreenshotConfig } from "../../../types";

export type ArrowStyle =
  | "loop"
  | "sweep"
  | "straight"
  | "curve"
  | "block"
  | "zigzag"
  // Kept only for in-memory compatibility with an annotation being edited
  // while the toolbar code hot-reloads. It is no longer exposed as a preset.
  | "label";
export const ARROW_STYLE_OPTIONS: ReadonlyArray<{ value: ArrowStyle; label: string }> = [
  { value: "loop", label: "回旋" },
  { value: "sweep", label: "扫尾" },
  { value: "straight", label: "直线" },
  { value: "curve", label: "弧线" },
  { value: "block", label: "块状" },
  { value: "zigzag", label: "折线" },
];
export type TextFont = "sans" | "serif" | "mono";

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

export interface ToolSettings {
  strokeColor: string;
  strokeWidth: number;
  fillOpacity: number;
  arrowStyle: ArrowStyle;
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
