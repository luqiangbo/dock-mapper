import {
  type Arrowhead,
  type ArrowStyle,
  type FillStyle,
  type LineStyle,
  type Roughness,
  type TextStyle,
} from "../components/annotationTypes";
import { simplifyScenePoints, type RasterAnnotation } from "../components/annotationScene";
import type { AnnotationGesture } from "../components/annotationGesture";
import type { AnnotationOutlineConfig } from "../../../types";

export interface RasterGestureSettings {
  strokeColor: string;
  strokeWidth: number;
  outline: AnnotationOutlineConfig;
  lineStyle: LineStyle;
  fillStyle: FillStyle;
  fillColor: string;
  roughness: Roughness;
  arrowStyle: ArrowStyle;
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
  penWidth: number;
  penPressure: boolean;
  highlightWidth: number;
  highlightOpacity: number;
  mosaicBlock: number;
  textStyle: TextStyle;
}

export type ActiveAnnotationGesture = AnnotationGesture<RasterAnnotation[]> & {
  id: string;
  settings: RasterGestureSettings;
  disableBinding?: boolean;
  multiClick?: boolean;
  completeOnFinish?: boolean;
};

/** Converts mutable pointer input into the immutable scene object used by preview and commit. */
export function annotationFromGesture(
  gesture: ActiveAnnotationGesture,
  scale: number,
): RasterAnnotation {
  const isFreehand = gesture.tool === "pen" || gesture.tool === "highlight";
  const isMultiPoint = gesture.multiClick && (gesture.tool === "line" || gesture.tool === "arrow");
  const last = gesture.points[gesture.points.length - 1] ?? gesture.start;
  return {
    id: gesture.id,
    kind: gesture.tool,
    points: isFreehand || isMultiPoint
      ? simplifyScenePoints(gesture.points, Math.max(0.75, scale * 0.35))
      : [{ ...gesture.start }, { ...last }],
    style: {
      color: gesture.settings.strokeColor,
      backgroundColor: gesture.settings.fillColor,
      lineStyle: gesture.settings.lineStyle,
      fillStyle: gesture.settings.fillStyle,
      roughness: gesture.settings.roughness,
      strokeWidth:
        gesture.tool === "pen"
          ? gesture.settings.penWidth * scale
          : gesture.tool === "highlight"
            ? gesture.settings.highlightWidth * scale
            : gesture.tool === "arrow" || gesture.tool === "line"
              ? gesture.settings.strokeWidth * scale
              : gesture.settings.strokeWidth * scale,
      outline: {
        ...gesture.settings.outline,
        enabled: gesture.tool === "mosaic" ? false : gesture.settings.outline.enabled,
        width: gesture.settings.outline.width * scale,
      },
      arrowStyle: gesture.settings.arrowStyle,
      startArrowhead: gesture.settings.startArrowhead,
      endArrowhead: gesture.settings.endArrowhead,
      opacity: gesture.tool === "highlight" ? gesture.settings.highlightOpacity : 1,
      pressure: gesture.tool === "pen" ? gesture.settings.penPressure : false,
      mosaicBlock: Math.max(4, Math.round(gesture.settings.mosaicBlock * scale)),
      arrowLabel: "",
      arrowLabelStyle: {
        ...gesture.settings.textStyle,
        fontSize: gesture.settings.textStyle.fontSize * scale,
        strokeWidth: gesture.settings.textStyle.strokeWidth * scale,
      },
    },
    angle: 0,
    groupId: null,
    version: 1,
    seed: Math.abs(
      Array.from(gesture.id).reduce(
        (value, character) => ((value * 31) ^ character.charCodeAt(0)) | 0,
        17,
      ),
    ),
  };
}
