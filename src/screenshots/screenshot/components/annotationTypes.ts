import type { ScreenshotConfig } from "../../../types";

export type ArrowStyle =
  | "filled"
  | "outline"
  | "double"
  | "double-outline"
  | "chevron"
  | "double-chevron"
  | "narrow"
  | "start-dot"
  | "start-dot-outline"
  | "start-bar"
  | "start-diamond"
  | "start-tail";
export const ARROW_STYLE_OPTIONS: ReadonlyArray<{ value: ArrowStyle; label: string }> = [
  { value: "filled", label: "实心箭头" },
  { value: "outline", label: "线框箭头" },
  { value: "double", label: "双向箭头" },
  { value: "double-outline", label: "双向线框" },
  { value: "chevron", label: "V 形" },
  { value: "double-chevron", label: "双向 V 形" },
  { value: "narrow", label: "细长三角" },
  { value: "start-dot", label: "圆点起点" },
  { value: "start-dot-outline", label: "空心圆起点" },
  { value: "start-bar", label: "短线起点" },
  { value: "start-diamond", label: "菱形起点" },
  { value: "start-tail", label: "燕尾起点" },
];
export type TextFont = "sans" | "serif" | "mono";

export interface TextStyle {
  fontSize: 14 | 16 | 20 | 24 | 32 | 40 | 48;
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
