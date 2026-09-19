import type { AnnotTool } from "./AnnotationToolbar";
import type { Arrowhead, ArrowStyle, ElementRoundness, FillStyle, LineStyle, Roughness, TextStyle } from "./annotationTypes";

/** AppState stores the choice as text; rectangle elements store type 3. */
export function excalidrawCurrentItemRoundness(
  roundness: ElementRoundness,
): ElementRoundness {
  return roundness;
}

export function excalidrawRectangleRoundness(
  roundness: ElementRoundness,
): { type: 3 } | null {
  return roundness === "round" ? { type: 3 } : null;
}

export interface ExcalidrawSelectionState {
  tool: AnnotTool | null;
  tools: AnnotTool[];
  count: number;
  mixedProperties?: string[];
  strokeColor?: string;
  strokeWidth?: number;
  lineStyle?: LineStyle;
  fillColor?: string;
  fillStyle?: FillStyle;
  roughness?: Roughness;
  roundness?: ElementRoundness;
  opacity?: number;
  arrowStyle?: ArrowStyle;
  startArrowhead?: Arrowhead;
  endArrowhead?: Arrowhead;
  textStyle?: TextStyle;
}

function sameValues<T extends string | null>(left: readonly T[], right: readonly T[]): boolean {
  if (left.length !== right.length) return false;
  return [...left].sort().every((tool, index) => tool === [...right].sort()[index]);
}

function sameTextStyle(left?: TextStyle, right?: TextStyle): boolean {
  return left?.fontSize === right?.fontSize && left?.color === right?.color &&
    left?.font === right?.font && left?.textAlign === right?.textAlign &&
    left?.opacity === right?.opacity && left?.bold === right?.bold &&
    left?.strokeColor === right?.strokeColor && left?.strokeWidth === right?.strokeWidth;
}

/** Avoid feeding Excalidraw's repeated onChange notifications back into React. */
export function isSameExcalidrawSelection(
  left: ExcalidrawSelectionState,
  right: ExcalidrawSelectionState,
): boolean {
  return left.tool === right.tool && left.count === right.count &&
    sameValues(left.tools, right.tools) && sameValues(left.mixedProperties ?? [], right.mixedProperties ?? []) &&
    left.strokeColor === right.strokeColor &&
    left.strokeWidth === right.strokeWidth && left.lineStyle === right.lineStyle &&
    left.fillColor === right.fillColor && left.fillStyle === right.fillStyle &&
    left.roughness === right.roughness && left.roundness === right.roundness &&
    left.opacity === right.opacity && left.arrowStyle === right.arrowStyle &&
    left.startArrowhead === right.startArrowhead && left.endArrowhead === right.endArrowhead &&
    sameTextStyle(left.textStyle, right.textStyle);
}

export const EXCALIDRAW_TOOL_TYPES: Partial<Record<Exclude<AnnotTool, null>, string>> = {
  select: "selection",
  rect: "rectangle",
  ellipse: "ellipse",
  diamond: "diamond",
  line: "line",
  arrow: "arrow",
  pen: "freedraw",
  text: "text",
  eraser: "eraser",
};

export const EXCALIDRAW_STYLE_TOOLS = new Set([
  "rect",
  "ellipse",
  "diamond",
  "line",
  "arrow",
  "pen",
  "text",
] as const);

export function isExcalidrawStyleTool(tool: AnnotTool): tool is Exclude<AnnotTool, null> {
  return Boolean(tool && EXCALIDRAW_STYLE_TOOLS.has(tool as never));
}

export interface ExcalidrawStyleCapabilities {
  fill: boolean;
  arrow: boolean;
  text: boolean;
  strokeWidth: boolean;
  lineStyle: boolean;
  roughness: boolean;
  roundness: boolean;
  opacity: boolean;
}

export function excalidrawStyleCapabilities(
  tools: readonly AnnotTool[],
): ExcalidrawStyleCapabilities {
  const kinds = [...new Set(tools.filter(isExcalidrawStyleTool))];
  const all = (predicate: (tool: typeof kinds[number]) => boolean) =>
    kinds.length > 0 && kinds.every(predicate);
  const frames = all((tool) => tool === "rect" || tool === "ellipse" || tool === "diamond");
  const linear = all(
    (tool) => tool === "rect" || tool === "ellipse" || tool === "diamond" ||
      tool === "line" || tool === "arrow",
  );
  return {
    fill: frames,
    arrow: all((tool) => tool === "arrow"),
    text: all((tool) => tool === "text"),
    strokeWidth: !kinds.includes("text"),
    lineStyle: linear,
    roughness: linear,
    roundness: all((tool) => tool === "rect"),
    opacity: kinds.length > 0,
  };
}

export function excalidrawToolType(tool: AnnotTool): string {
  return tool ? (EXCALIDRAW_TOOL_TYPES[tool] ?? "selection") : "selection";
}

export function captureBackgroundSkeleton(fileId: string, width: number, height: number) {
  // A locked transparent frame gives Excalidraw a stable physical-pixel
  // viewport without embedding a second copy of the screenshot.
  return {
    id: fileId,
    type: "rectangle" as const,
    x: 0,
    y: 0,
    width,
    height,
    strokeColor: "transparent",
    backgroundColor: "transparent",
    opacity: 0,
    strokeWidth: 1,
    locked: true,
  };
}

export function captureExportDimensions(width: number, height: number) {
  return { width, height, scale: 1 };
}

export interface PhysicalCrop {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
}

export function transformBetweenCrops(
  x: number,
  y: number,
  previous: PhysicalCrop,
  next: PhysicalCrop,
): { x: number; y: number; scaleX: number; scaleY: number } {
  const scaleX = (previous.sourceWidth / previous.outputWidth) *
    (next.outputWidth / next.sourceWidth);
  const scaleY = (previous.sourceHeight / previous.outputHeight) *
    (next.outputHeight / next.sourceHeight);
  return {
    x: (previous.sourceX + x * previous.sourceWidth / previous.outputWidth - next.sourceX) *
      next.outputWidth / next.sourceWidth,
    y: (previous.sourceY + y * previous.sourceHeight / previous.outputHeight - next.sourceY) *
      next.outputHeight / next.sourceHeight,
    scaleX,
    scaleY,
  };
}

/** Presentation contract used by the host while the locked background loads. */
export function screenshotEditorPresentation(ready: boolean) {
  return { dataReady: ready ? "true" : "false", ariaHidden: !ready };
}
