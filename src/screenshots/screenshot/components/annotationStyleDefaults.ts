import type { AnnotationToolStyleConfig, ScreenshotAnnotationStyles } from "../../../types";

export const DEFAULT_TOOL_STYLE: AnnotationToolStyleConfig = {
  stroke_color: "#e03131",
  background_color: "#e03131",
  stroke_width: 6,
  stroke_style: "solid",
  fill_style: "none",
  roughness: 2,
  opacity: 1,
  arrow_type: "sharp",
  start_arrowhead: "none",
  end_arrowhead: "arrow",
  pressure: true,
  block_size: 12,
  mosaic_effect: "pixelate",
  blur_radius: 12,
  font_size: 24,
  font_family: "microsoft-yahei",
  marker_size: 36,
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
  highlight: toolStyle({ stroke_width: 24, opacity: 0.32, pressure: false }),
  text: toolStyle({ background_color: "#000000" }),
  number: toolStyle({ stroke_color: "#ffffff", background_color: "#e03131" }),
  mosaic: toolStyle(),
};

export function cloneAnnotationStyles(
  styles: ScreenshotAnnotationStyles,
): ScreenshotAnnotationStyles {
  return Object.fromEntries(
    Object.entries(styles).map(([key, value]) => [
      key,
      {
        ...DEFAULT_TOOL_STYLE,
        ...value,
        mosaic_effect: value.mosaic_effect === "blur" ? "blur" : "pixelate",
        blur_radius: Math.max(
          2,
          Math.min(32, Math.round(Number.isFinite(value.blur_radius) ? value.blur_radius : 12)),
        ),
      },
    ]),
  ) as unknown as ScreenshotAnnotationStyles;
}
