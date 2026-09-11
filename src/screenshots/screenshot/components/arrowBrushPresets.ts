export type ArrowBrushId =
  | "solid"
  | "marker"
  | "highlighter"
  | "brush-pen"
  | "pencil"
  | "charcoal"
  | "watercolor"
  | "spray"
  | "hatch";

export type ArrowBrushFamily =
  | "solid"
  | "marker"
  | "bristle"
  | "grain"
  | "wet"
  | "scatter"
  | "pattern";

export type ArrowBrushGroup = "基础与墨水" | "干性笔触" | "湿性颜料" | "散射与图案";

export interface ArrowBrushPreset {
  id: ArrowBrushId;
  label: string;
  group: ArrowBrushGroup;
  family: ArrowBrushFamily;
  /** Logical pixels used when a new arrow is created or a preset is applied. */
  size: number;
  /** One composite alpha for the complete arrow. */
  opacity: number;
  /** Extra painted room outside the geometry, relative to its width. */
  bleed: number;
  /** Family-specific strength/density, normalized to 0..1. */
  texture: number;
  /** Family-specific mark spacing, normalized to 0..1. */
  spacing: number;
}

export const ARROW_BRUSH_PRESETS: readonly ArrowBrushPreset[] = [
  { id: "solid", label: "硬边", group: "基础与墨水", family: "solid", size: 7, opacity: 1, bleed: 0, texture: 0, spacing: 0 },
  { id: "marker", label: "马克笔", group: "基础与墨水", family: "marker", size: 10, opacity: 0.68, bleed: 0.12, texture: 0.32, spacing: 0.2 },
  { id: "highlighter", label: "荧光笔", group: "基础与墨水", family: "marker", size: 11, opacity: 0.36, bleed: 0.15, texture: 0.12, spacing: 0.32 },
  { id: "brush-pen", label: "毛笔", group: "基础与墨水", family: "bristle", size: 8, opacity: 0.9, bleed: 0.75, texture: 0.48, spacing: 0.18 },
  { id: "pencil", label: "铅笔", group: "干性笔触", family: "grain", size: 6, opacity: 0.8, bleed: 1, texture: 0.42, spacing: 0.12 },
  { id: "charcoal", label: "炭笔", group: "干性笔触", family: "grain", size: 9, opacity: 0.78, bleed: 1.6, texture: 0.86, spacing: 0.34 },
  { id: "watercolor", label: "水彩", group: "湿性颜料", family: "wet", size: 11, opacity: 0.68, bleed: 0.62, texture: 0.76, spacing: 0.4 },
  { id: "spray", label: "喷枪", group: "散射与图案", family: "scatter", size: 10, opacity: 0.5, bleed: 1.4, texture: 0.74, spacing: 0.44 },
  { id: "hatch", label: "排线", group: "散射与图案", family: "pattern", size: 8, opacity: 0.72, bleed: 0.14, texture: 0.66, spacing: 0.28 },
] as const;

export const ARROW_BRUSH_GROUPS: readonly ArrowBrushGroup[] = [
  "基础与墨水",
  "干性笔触",
  "湿性颜料",
  "散射与图案",
];

export const ARROW_BRUSH_RENDER_VERSION = 4;
export const DEFAULT_ARROW_BRUSH_ID: ArrowBrushId = "solid";

const PRESET_BY_ID = new Map(ARROW_BRUSH_PRESETS.map((preset) => [preset.id, preset]));

/** Resolve new ids and old in-memory effects without persisting screenshot state. */
export function normalizeArrowBrushId(value?: string, legacyEffect?: string): ArrowBrushId {
  if (value && PRESET_BY_ID.has(value as ArrowBrushId)) return value as ArrowBrushId;
  switch (legacyEffect ?? value) {
    case "marker":
    case "dry-marker":
      return "marker";
    case "crayon":
    case "chalk":
    case "pastel":
    case "ink":
    case "handdrawn":
      return "charcoal";
    case "watercolor":
    case "gouache":
    case "ink-wash":
      return "watercolor";
    case "brush-pen":
    case "calligraphy":
    case "flat-bristle":
    case "round-bristle":
    case "rake":
    case "oil":
      return "brush-pen";
    case "airbrush":
    case "splatter":
      return "spray";
    case "halftone":
      return "hatch";
    case "classic":
    case "gradient":
    default:
      return DEFAULT_ARROW_BRUSH_ID;
  }
}

export function getArrowBrushPreset(value?: string, legacyEffect?: string): ArrowBrushPreset {
  return PRESET_BY_ID.get(normalizeArrowBrushId(value, legacyEffect))!;
}

export function createArrowBrushStylePatch(
  brushId: ArrowBrushId,
  sceneScale: number,
): { arrowBrushId: ArrowBrushId; strokeWidth: number } {
  const scale = Number.isFinite(sceneScale) ? Math.max(0.01, sceneScale) : 1;
  return {
    arrowBrushId: brushId,
    strokeWidth: getArrowBrushPreset(brushId).size * scale,
  };
}
