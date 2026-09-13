import type {
  Arrowhead,
  ArrowStyle,
  FillStyle,
  FrameShape,
  LegacyFrameEffect,
  LineStyle,
  Roughness,
  TextStyle,
} from "./annotationTypes";
import type { AnnotationOutlineConfig } from "../../../types";
import { hasVisibleArrowLength } from "./arrowGeometry";
import type { ArrowAssemblyVariation } from "./arrowAssembly";
import {
  arrowVisualBounds,
  styledLinePadding,
} from "./annotationLineRenderer";

export interface ScenePoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface RasterAnnotationStyle {
  color: string;
  backgroundColor?: string;
  strokeWidth: number;
  outline: AnnotationOutlineConfig;
  lineStyle?: LineStyle;
  fillStyle?: FillStyle;
  roughness?: Roughness;
  pressure?: boolean;
  arrowStyle: ArrowStyle;
  startArrowhead?: Arrowhead;
  endArrowhead?: Arrowhead;
  arrowAssembly?: ArrowAssemblyVariation;
  /** Legacy hot-reload/undo compatibility. New annotations never write these fields. */
  gradientStops?: Array<{ offset: number; color: string }>;
  fillOpacity?: number;
  arrowBrushId?: string;
  arrowEffect?: string;
  shapeEffect?: LegacyFrameEffect;
  arrowHeadSize?: number;
  opacity: number;
  mosaicBlock: number;
  arrowLabel?: string;
  arrowLabelStyle?: TextStyle;
}

export interface AnnotationBinding {
  elementId: string;
  anchor: { x: number; y: number };
}

export type RasterAnnotationKind =
  | "rect"
  | "ellipse"
  | "diamond"
  | "line"
  | "arrow"
  | "pen"
  | "highlight"
  | "mosaic";

export interface RasterAnnotation {
  id: string;
  kind: RasterAnnotationKind;
  points: ScenePoint[];
  style: RasterAnnotationStyle;
  angle?: number;
  groupId?: string | null;
  version?: number;
  seed?: number;
  startBinding?: AnnotationBinding | null;
  endBinding?: AnnotationBinding | null;
}

export interface SceneBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function annotationSolidColor(style: RasterAnnotationStyle): string {
  return (
    style.gradientStops?.find(
      (stop) => typeof stop.color === "string" && stop.color.trim().length > 0,
    )?.color ?? style.color
  );
}

export function isFrameAnnotationKind(kind: string | null): kind is FrameShape {
  return kind === "rect" || kind === "ellipse" || kind === "diamond";
}

export function convertFrameAnnotation(
  annotation: RasterAnnotation,
  kind: FrameShape,
): RasterAnnotation {
  return isFrameAnnotationKind(annotation.kind) && annotation.kind !== kind
    ? { ...annotation, kind }
    : annotation;
}

function annotationPadding(annotation: RasterAnnotation): number {
  const labelPadding =
    annotation.kind === "arrow" && annotation.style.arrowStyle === "label"
      ? (annotation.style.arrowLabelStyle?.fontSize ?? 0) / 2 + 6
      : 0;
  if (annotation.kind === "arrow") return labelPadding;
  const outlineWidth = annotation.style.outline.enabled ? annotation.style.outline.width : 0;
  return Math.max(
    4,
    styledLinePadding(annotation.style.strokeWidth, outlineWidth),
    labelPadding,
  );
}

export function annotationGeometryBounds(annotation: RasterAnnotation): SceneBounds {
  const lastPoint = annotation.points[annotation.points.length - 1];
  if ((annotation.kind === "arrow" || annotation.kind === "line") && annotation.points[0] && lastPoint) {
    return arrowVisualBounds(
      annotation.points[0],
      lastPoint,
      annotation.kind === "line" ? "sharp" : annotation.style.arrowStyle,
      annotation.style.strokeWidth,
      annotation.id,
      annotation.style.outline.enabled ? annotation.style.outline.width : 0,
      annotation.style.lineStyle,
      annotation.points,
    );
  }
  const xs = annotation.points.map((point) => point.x);
  const ys = annotation.points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function cloneRasterAnnotations(items: RasterAnnotation[]): RasterAnnotation[] {
  return items.map((item) => ({
    ...item,
    points: item.points.map((point) => ({ ...point })),
    style: {
      ...item.style,
      outline: { ...item.style.outline },
      gradientStops: item.style.gradientStops?.map((stop) => ({ ...stop })),
      arrowLabelStyle: item.style.arrowLabelStyle ? { ...item.style.arrowLabelStyle } : undefined,
      arrowAssembly: item.style.arrowAssembly
        ? {
            ...item.style.arrowAssembly,
          }
        : undefined,
    },
    startBinding: item.startBinding
      ? { ...item.startBinding, anchor: { ...item.startBinding.anchor } }
      : item.startBinding,
    endBinding: item.endBinding
      ? { ...item.endBinding, anchor: { ...item.endBinding.anchor } }
      : item.endBinding,
  }));
}

export function simplifyScenePoints(points: ScenePoint[], minimumDistance = 1): ScenePoint[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  const result = [{ ...points[0] }];
  let previous = points[0];
  const threshold = minimumDistance * minimumDistance;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    if (dx * dx + dy * dy >= threshold) {
      result.push({ ...point });
      previous = point;
    }
  }
  result.push({ ...points[points.length - 1] });
  return result;
}

function unrotatedAnnotationBounds(annotation: RasterAnnotation): SceneBounds {
  const geometry = annotationGeometryBounds(annotation);
  const padding = annotationPadding(annotation);
  if (annotation.kind === "arrow" && annotation.style.arrowStyle === "label") {
    const first = annotation.points[0];
    const last = annotation.points[annotation.points.length - 1] ?? first;
    const label = annotation.style.arrowLabel?.trim() ?? "";
    const fontSize = annotation.style.arrowLabelStyle?.fontSize ?? 24;
    const labelWidth = Math.max(fontSize * 1.5, label.length * fontSize * 0.68) + 16;
    const labelHeight = fontSize + 12;
    const labelX = (first.x + last.x) / 2 - labelWidth / 2;
    const labelY = (first.y + last.y) / 2 - labelHeight / 2;
    const left = Math.min(geometry.x - padding, labelX);
    const top = Math.min(geometry.y - padding, labelY);
    const right = Math.max(geometry.x + geometry.width + padding, labelX + labelWidth);
    const bottom = Math.max(geometry.y + geometry.height + padding, labelY + labelHeight);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
  return {
    x: geometry.x - padding,
    y: geometry.y - padding,
    width: geometry.width + padding * 2,
    height: geometry.height + padding * 2,
  };
}

function rotatePoint(point: ScenePoint, center: ScenePoint, angle: number): ScenePoint {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cosine - dy * sine,
    y: center.y + dx * sine + dy * cosine,
  };
}

export function annotationBounds(annotation: RasterAnnotation): SceneBounds {
  const bounds = unrotatedAnnotationBounds(annotation);
  const angle = annotation.angle ?? 0;
  if (!angle) return bounds;
  const geometry = annotationGeometryBounds(annotation);
  const center = { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 };
  const corners = [
    rotatePoint({ x: bounds.x, y: bounds.y }, center, angle),
    rotatePoint({ x: bounds.x + bounds.width, y: bounds.y }, center, angle),
    rotatePoint({ x: bounds.x + bounds.width, y: bounds.y + bounds.height }, center, angle),
    rotatePoint({ x: bounds.x, y: bounds.y + bounds.height }, center, angle),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function translateAnnotation(
  annotation: RasterAnnotation,
  dx: number,
  dy: number,
  canvasWidth: number,
  canvasHeight: number,
): RasterAnnotation {
  const bounds = annotationBounds(annotation);
  const clampedDx = Math.max(-bounds.x, Math.min(dx, canvasWidth - bounds.x - bounds.width));
  const clampedDy = Math.max(-bounds.y, Math.min(dy, canvasHeight - bounds.y - bounds.height));
  return {
    ...annotation,
    points: annotation.points.map((point) => ({
      x: point.x + clampedDx,
      y: point.y + clampedDy,
    })),
  };
}

export function resizeAnnotation(
  annotation: RasterAnnotation,
  nextBounds: SceneBounds,
): RasterAnnotation {
  const current = annotationGeometryBounds(annotation);
  if (annotation.kind === "arrow" && annotation.style.arrowStyle !== "label") {
    // Presets resize uniformly: the endpoints and the arrow width scale by the
    // same factor, so drawing, the selection box and the cache stay in step.
    // The brush bleed is not proportional, so the factor is fitted against the
    // real bounds and only a factor that stays inside the target is used.
    const previous = annotationBounds(annotation);
    const scaled = (scale: number): RasterAnnotation => ({
      ...annotation,
      style: {
        ...annotation.style,
        strokeWidth: annotation.style.strokeWidth * scale,
        outline: {
          ...annotation.style.outline,
          width: annotation.style.outline.width * scale,
        },
      },
      points: annotation.points.map((point) => ({ x: point.x * scale, y: point.y * scale })),
    });
    // The painted bounds grow monotonically with the factor, so the largest
    // factor that still fits is found by bracketing and bisection.
    const fits = (scale: number): boolean => {
      const candidate = annotationBounds(scaled(scale));
      return (
        candidate.width <= nextBounds.width + 1e-9 && candidate.height <= nextBounds.height + 1e-9
      );
    };
    let low = 0.01;
    let high = Math.max(
      0.02,
      Math.min(nextBounds.width / previous.width, nextBounds.height / previous.height),
    );
    for (let pass = 0; pass < 10 && fits(high); pass += 1) {
      low = high;
      high *= 2;
    }
    for (let pass = 0; pass < 18; pass += 1) {
      const middle = (low + high) / 2;
      if (fits(middle)) low = middle;
      else high = middle;
    }
    const resized = scaled(low);
    const bounds = annotationBounds(resized);
    const x =
      Math.abs(nextBounds.x - previous.x) > 0.01
        ? nextBounds.x + nextBounds.width - bounds.width
        : nextBounds.x;
    const y =
      Math.abs(nextBounds.y - previous.y) > 0.01
        ? nextBounds.y + nextBounds.height - bounds.height
        : nextBounds.y;
    return {
      ...resized,
      points: resized.points.map((point) => ({
        x: point.x + x - bounds.x,
        y: point.y + y - bounds.y,
      })),
    };
  }
  const padding = annotationPadding(annotation);
  const targetWidth = Math.max(1, nextBounds.width - padding * 2);
  const targetHeight = Math.max(1, nextBounds.height - padding * 2);
  const targetX = nextBounds.x + padding;
  const targetY = nextBounds.y + padding;
  const scaleX = targetWidth / current.width;
  const scaleY = targetHeight / current.height;
  const labelScale = Math.max(0.1, (Math.abs(scaleX) + Math.abs(scaleY)) / 2);
  return {
    ...annotation,
    style: annotation.style.arrowLabelStyle
      ? {
          ...annotation.style,
          arrowLabelStyle: {
            ...annotation.style.arrowLabelStyle,
            fontSize: Math.max(
              8,
              Math.round(annotation.style.arrowLabelStyle.fontSize * labelScale),
            ),
            strokeWidth: annotation.style.arrowLabelStyle.strokeWidth * labelScale,
          },
        }
      : annotation.style,
    points: annotation.points.map((point) => ({
      x: targetX + (point.x - current.x) * scaleX,
      y: targetY + (point.y - current.y) * scaleY,
    })),
  };
}

/** A drag that produces no readable shape must not create an object. */
export function isPaintableAnnotation(annotation: RasterAnnotation): boolean {
  const first = annotation.points[0];
  const last = annotation.points[annotation.points.length - 1] ?? first;
  if (!first || !last) return false;
  if (annotation.kind === "arrow" && annotation.style.arrowStyle !== "label")
    return hasVisibleArrowLength(first, last);
  return true;
}

export function hitTestAnnotation(
  annotation: RasterAnnotation,
  point: ScenePoint,
  tolerance = 6,
): boolean {
  const bounds = annotationGeometryBounds(annotation);
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const local = rotatePoint(point, center, -(annotation.angle ?? 0));
  const width = Math.max(tolerance, annotation.style.strokeWidth / 2 + tolerance);
  if (annotation.kind === "ellipse") {
    const radiusX = Math.max(1, bounds.width / 2);
    const radiusY = Math.max(1, bounds.height / 2);
    const dx = (local.x - center.x) / radiusX;
    const dy = (local.y - center.y) / radiusY;
    const distance = dx * dx + dy * dy;
    return annotation.style.fillStyle !== "none"
      ? distance <= 1 + width / Math.min(radiusX, radiusY)
      : Math.abs(Math.sqrt(distance) - 1) <= width / Math.min(radiusX, radiusY);
  }
  if (annotation.kind === "diamond") {
    const normalized =
      Math.abs(local.x - center.x) / Math.max(1, bounds.width / 2) +
      Math.abs(local.y - center.y) / Math.max(1, bounds.height / 2);
    return annotation.style.fillStyle !== "none"
      ? normalized <= 1 + width / Math.min(bounds.width, bounds.height)
      : Math.abs(normalized - 1) <= (width * 2) / Math.min(bounds.width, bounds.height);
  }
  if (annotation.kind === "line" || annotation.kind === "arrow" || annotation.kind === "pen" || annotation.kind === "highlight") {
    for (let index = 1; index < annotation.points.length; index += 1) {
      const start = annotation.points[index - 1];
      const end = annotation.points[index];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy;
      const amount = lengthSquared
        ? Math.max(0, Math.min(1, ((local.x - start.x) * dx + (local.y - start.y) * dy) / lengthSquared))
        : 0;
      if (Math.hypot(local.x - (start.x + dx * amount), local.y - (start.y + dy * amount)) <= width)
        return true;
    }
    return false;
  }
  return local.x >= bounds.x - width && local.x <= bounds.x + bounds.width + width && local.y >= bounds.y - width && local.y <= bounds.y + bounds.height + width;
}
