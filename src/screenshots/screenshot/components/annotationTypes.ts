import type {
  AnnotationArrowhead,
  AnnotationArrowType,
  AnnotationFillStyle,
  AnnotationOutlineConfig,
  AnnotationStrokeStyle,
  ScreenshotConfig,
} from "../../../types";
export type ArrowPreset = AnnotationArrowType;
export type ArrowStyle = ArrowPreset
  | "straight" | "segmented" | "double"
  | "zigzag" | "loop" | "sweep" | "curve" | "block" | "lightning"
  // Kept only for in-memory compatibility with an annotation being edited
  // while the toolbar code hot-reloads. It is no longer exposed as a preset.
  | "label";
export const ARROW_STYLE_OPTIONS: ReadonlyArray<{ value: ArrowPreset; label: string }> = [
  { value: "sharp", label: "尖锐" },
  { value: "round", label: "曲线" },
  { value: "elbow", label: "肘形" },
];
export function normalizeArrowStyle(style: ArrowStyle): ArrowPreset {
  if (style === "round" || style === "elbow") return style;
  return "sharp";
}
export type LineStyle = AnnotationStrokeStyle;
export type FillStyle = AnnotationFillStyle;
export type Arrowhead = AnnotationArrowhead;
export type Roughness = 0 | 1 | 2;
export const DEFAULT_LINE_STYLE: LineStyle = "solid";
const EXCALIDRAW_STROKE_WIDTHS = [1, 2, 3, 4, 6, 8, 12] as const;
export function normalizeExcalidrawStrokeWidth(value: number): number {
  return EXCALIDRAW_STROKE_WIDTHS.reduce((closest, candidate) =>
    Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest
  );
}
export const LINE_STYLE_OPTIONS: ReadonlyArray<{ value: LineStyle; label: string }> = [
  { value: "solid", label: "实线" },
  { value: "dashed", label: "虚线" },
  { value: "dotted", label: "点线" },
];
export const FILL_STYLE_OPTIONS: ReadonlyArray<{ value: FillStyle; label: string }> = [
  { value: "none", label: "无填充" },
  { value: "solid", label: "纯色" },
  { value: "hachure", label: "排线" },
  { value: "cross_hatch", label: "交叉排线" },
  { value: "zigzag" as FillStyle, label: "锯齿" },
];
export const ROUGHNESS_OPTIONS: ReadonlyArray<{ value: Roughness; label: string }> = [
  { value: 0, label: "精准" },
  { value: 1, label: "手绘" },
  { value: 2, label: "粗糙" },
];
export const ARROWHEAD_OPTIONS: ReadonlyArray<{ value: Arrowhead; label: string }> = [
  { value: "none", label: "无" },
  { value: "arrow", label: "箭头" },
  { value: "triangle", label: "实心三角" },
  { value: "circle", label: "实心圆" },
  { value: "diamond", label: "实心菱形" },
  { value: "bar", label: "横杠" },
  { value: "dot" as Arrowhead, label: "圆点" },
  { value: "circle_outline" as Arrowhead, label: "空心圆" },
  { value: "triangle_outline" as Arrowhead, label: "空心三角" },
  { value: "diamond_outline" as Arrowhead, label: "空心菱形" },
  { value: "crowfoot_one" as Arrowhead, label: "Crowfoot 1" },
  { value: "crowfoot_many" as Arrowhead, label: "Crowfoot 多" },
  { value: "crowfoot_one_or_many" as Arrowhead, label: "Crowfoot 1/多" },
];

/** Read old hot-reload/undo objects without keeping their renderer alive. */
export function normalizeLineStyle(
  value?: string,
  legacyEffect?: string,
  legacyBrush?: string,
): LineStyle {
  if (value === "solid" || value === "dashed" || value === "dotted") return value;
  if (value === "hachure" || value === "sticker" || value === "sketch") return "solid";
  const legacy = legacyEffect ?? legacyBrush;
  if (legacy === "hatch") return "solid";
  if (legacy === "classic" || legacy === "gradient" || legacy === "solid") return "solid";
  return DEFAULT_LINE_STYLE;
}
export type TextFont =
  | "virgil"
  | "helvetica"
  | "cascadia"
  | "excalifont"
  | "nunito"
  | "lilita"
  | "comic-shanns"
  | "liberation-sans"
  | "sans"
  | "serif"
  | "mono";
export type TextAlign = "left" | "center" | "right";
export type ElementRoundness = "sharp" | "round";
/** @deprecated Only used while normalizing an in-memory annotation from older code. */
export type LegacyFrameEffect =
  | "classic"
  | "crayon"
  | "handdrawn"
  | "watercolor"
  | "ink"
  | "cartoon"
  | "gradient"
  | "decorative";
export type FrameShape = "rect" | "ellipse" | "diamond";
export const FRAME_SHAPE_OPTIONS: ReadonlyArray<{ value: FrameShape; label: string }> = [
  { value: "rect", label: "矩形" },
  { value: "ellipse", label: "圆形" },
  { value: "diamond", label: "菱形" },
];

export interface TextStyle {
  fontSize: number;
  color: string;
  font: TextFont;
  textAlign: TextAlign;
  opacity: number;
  bold: boolean;
  strokeColor: string;
  strokeWidth: number;
}

export interface NumberStyle {
  backgroundColor: string;
  textColor: string;
  size: number;
  outline: AnnotationOutlineConfig;
}

export interface ToolSettings {
  mixedProperties?: string[];
  strokeColor: string;
  outline: AnnotationOutlineConfig;
  strokeWidth: number;
  shapeKind: FrameShape;
  lineStyle: LineStyle;
  fillStyle: FillStyle;
  fillColor: string;
  roughness: Roughness;
  roundness: ElementRoundness;
  opacity: number;
  arrowStyle: ArrowStyle;
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
  penWidth: number;
  penPressure: boolean;
  highlightWidth: number;
  highlightOpacity: number;
  mosaicBlock: number;
  pickerFormat: ScreenshotConfig["color_copy_format"];
  textStyle: TextStyle;
  numberStyle: NumberStyle;
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontSize: 20,
  color: "#e03131",
  font: "helvetica",
  textAlign: "left",
  opacity: 100,
  bold: false,
  strokeColor: "#000000",
  strokeWidth: 0,
};
export const DEFAULT_NUMBER_STYLE: NumberStyle = {
  backgroundColor: "#ef4444",
  textColor: "#ffffff",
  size: 32,
  outline: { enabled: true, color: "#ffffff", width: 1 },
};
