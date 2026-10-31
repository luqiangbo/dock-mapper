import type { AnnotTool } from "./AnnotationToolbar";
import type { ToolSettings } from "./annotationTypes";
import { normalizeExcalidrawStrokeWidth } from "./annotationTypes";

export function captureWheelTool(active: AnnotTool, selected: AnnotTool): AnnotTool {
  return active === "select" ? selected : active;
}
export function captureWheelPatch(
  tool: AnnotTool,
  settings: ToolSettings,
  deltaY: number,
  opacity = false,
): Partial<ToolSettings> | null {
  if (!deltaY || !tool || tool === "select" || tool === "picker" || tool === "eraser") return null;
  const step = deltaY < 0 ? 1 : -1;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  if (opacity)
    return tool === "highlight"
      ? {
          highlightOpacity:
            Math.round(clamp(settings.highlightOpacity + step * 0.05, 0.05, 1) * 100) / 100,
        }
      : { opacity: clamp(settings.opacity + step * 5, 5, 100) };
  if (tool === "text")
    return {
      textStyle: {
        ...settings.textStyle,
        fontSize: clamp(settings.textStyle.fontSize + step * 2, 8, 96),
      },
    };
  if (tool === "number")
    return {
      numberStyle: {
        ...settings.numberStyle,
        size: clamp(settings.numberStyle.size + step * 2, 16, 64),
      },
    };
  if (tool === "pen") return { penWidth: normalizeExcalidrawStrokeWidth(settings.penWidth + step) };
  if (tool === "highlight")
    return { highlightWidth: normalizeExcalidrawStrokeWidth(settings.highlightWidth + step * 2) };
  if (tool === "mosaic")
    return settings.mosaicEffect === "blur"
      ? { blurRadius: clamp(settings.blurRadius + step * 2, 2, 32) }
      : { mosaicBlock: clamp(settings.mosaicBlock + step * 2, 2, 64) };
  return { strokeWidth: normalizeExcalidrawStrokeWidth(settings.strokeWidth + step) };
}
