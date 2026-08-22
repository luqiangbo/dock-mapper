import type { ScreenshotConfig } from "../../../types";

export type ArrowStyle = "filled" | "outline" | "line" | "double";
export type TextFont = "sans" | "serif" | "mono";

export interface TextStyle {
  fontSize: 14 | 16 | 20 | 24 | 32 | 40 | 48;
  color: string;
  font: TextFont;
  bold: boolean;
  strokeColor: string;
  strokeWidth: number;
  backgroundColor: string;
  backgroundOpacity: number;
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
  backgroundColor: "#000000",
  backgroundOpacity: 0.72,
};
export const DEFAULT_NUMBER_STYLE: NumberStyle = {
  backgroundColor: "#ef4444",
  textColor: "#ffffff",
  size: 32,
};
