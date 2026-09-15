import type { AnnotTool } from "./AnnotationToolbar";
import type { Arrowhead, ArrowStyle, FillStyle, LineStyle, Roughness, TextStyle } from "./annotationTypes";

export interface ExcalidrawSelectionState {
  tool: AnnotTool | null;
  tools: AnnotTool[];
  count: number;
  strokeColor?: string;
  strokeWidth?: number;
  lineStyle?: LineStyle;
  fillColor?: string;
  fillStyle?: FillStyle;
  roughness?: Roughness;
  arrowStyle?: ArrowStyle;
  startArrowhead?: Arrowhead;
  endArrowhead?: Arrowhead;
  textStyle?: TextStyle;
}

function sameTools(left: readonly AnnotTool[], right: readonly AnnotTool[]): boolean {
  if (left.length !== right.length) return false;
  return [...left].sort().every((tool, index) => tool === [...right].sort()[index]);
}

function sameTextStyle(left?: TextStyle, right?: TextStyle): boolean {
  return left?.fontSize === right?.fontSize && left?.color === right?.color &&
    left?.font === right?.font && left?.bold === right?.bold &&
    left?.strokeColor === right?.strokeColor && left?.strokeWidth === right?.strokeWidth;
}

/** Avoid feeding Excalidraw's repeated onChange notifications back into React. */
export function isSameExcalidrawSelection(
  left: ExcalidrawSelectionState,
  right: ExcalidrawSelectionState,
): boolean {
  return left.tool === right.tool && left.count === right.count &&
    sameTools(left.tools, right.tools) && left.strokeColor === right.strokeColor &&
    left.strokeWidth === right.strokeWidth && left.lineStyle === right.lineStyle &&
    left.fillColor === right.fillColor && left.fillStyle === right.fillStyle &&
    left.roughness === right.roughness && left.arrowStyle === right.arrowStyle &&
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
  };
}

export function excalidrawToolType(tool: AnnotTool): string {
  return tool ? (EXCALIDRAW_TOOL_TYPES[tool] ?? "selection") : "selection";
}

export function captureBackgroundSkeleton(fileId: string, width: number, height: number) {
  return { id: fileId, type: "image" as const, x: 0, y: 0, width, height, fileId, locked: true };
}

export function captureExportDimensions(width: number, height: number) {
  return { width, height, scale: 1 };
}

/** Presentation contract used by the host while the locked background loads. */
export function screenshotEditorPresentation(ready: boolean) {
  return { dataReady: ready ? "true" : "false", ariaHidden: !ready };
}
