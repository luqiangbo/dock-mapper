import type {
  AnnotationToolStyleConfig,
  ScreenshotAnnotationStyles,
} from "../../../types";

export const DEFAULT_TOOL_STYLE: AnnotationToolStyleConfig = {
  stroke_color: "#e03131",
  background_color: "#ffc9c9",
  stroke_width: 3,
  stroke_style: "solid",
  fill_style: "none",
  roughness: 0,
  opacity: 1,
  arrow_type: "sharp",
  start_arrowhead: "none",
  end_arrowhead: "arrow",
  pressure: true,
  block_size: 12,
  font_size: 20,
  marker_size: 32,
  outline_enabled: true,
  outline_color: "#ffffff",
  outline_width: 1,
};

function toolStyle(changes: Partial<AnnotationToolStyleConfig> = {}): AnnotationToolStyleConfig {
  return { ...DEFAULT_TOOL_STYLE, ...changes };
}

export const DEFAULT_ANNOTATION_STYLES: ScreenshotAnnotationStyles = {
  shape: toolStyle(),
  line: toolStyle(),
  arrow: toolStyle(),
  pen: toolStyle(),
  highlight: toolStyle({ stroke_width: 20, opacity: 0.32, pressure: false }),
  text: toolStyle({ background_color: "#000000" }),
  number: toolStyle({ stroke_color: "#ffffff", background_color: "#ef4444" }),
  mosaic: toolStyle(),
};

export function cloneAnnotationStyles(
  styles: ScreenshotAnnotationStyles,
): ScreenshotAnnotationStyles {
  return Object.fromEntries(
    Object.entries(styles).map(([key, value]) => [key, { ...value }]),
  ) as unknown as ScreenshotAnnotationStyles;
}
