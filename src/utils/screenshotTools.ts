export const SCREENSHOT_TOOL_IDS = [
  "select",
  "rect",
  "arrow",
  "pen",
  "text",
  "mosaic",
  "ellipse",
  "diamond",
  "line",
  "highlight",
  "picker",
  "number",
  "eraser",
] as const;
export type ScreenshotToolId = (typeof SCREENSHOT_TOOL_IDS)[number];
export interface ScreenshotToolbarTool {
  id: ScreenshotToolId;
  visible: boolean;
}
export const SCREENSHOT_TOOL_LABELS: Record<ScreenshotToolId, string> = {
  select: "选择",
  rect: "矩形",
  arrow: "箭头",
  pen: "画笔",
  text: "文字",
  mosaic: "马赛克",
  ellipse: "圆形",
  diamond: "菱形",
  line: "线条",
  highlight: "高亮",
  picker: "取色",
  number: "序号",
  eraser: "橡皮擦",
};
export function defaultScreenshotTools(): ScreenshotToolbarTool[] {
  return SCREENSHOT_TOOL_IDS.map((id, index) => ({ id, visible: index < 6 }));
}
export function normalizeScreenshotTools(
  value?: readonly ScreenshotToolbarTool[],
): ScreenshotToolbarTool[] {
  if (!Array.isArray(value)) return defaultScreenshotTools();
  const tools: ScreenshotToolbarTool[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || !SCREENSHOT_TOOL_IDS.includes(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    tools.push({ id: item.id, visible: item.visible === true });
  }
  for (const item of defaultScreenshotTools()) if (!seen.has(item.id)) tools.push(item);
  return tools;
}
export function moveScreenshotTool(
  tools: readonly ScreenshotToolbarTool[],
  id: ScreenshotToolId,
  target: number,
) {
  const from = tools.findIndex((tool) => tool.id === id);
  if (from < 0 || target < 0 || target >= tools.length || target === from) return tools;
  const next = [...tools];
  const [moving] = next.splice(from, 1);
  next.splice(target, 0, moving);
  return next;
}
export function screenshotToolbarGroups(value?: readonly ScreenshotToolbarTool[]) {
  const tools = normalizeScreenshotTools(value);
  return {
    main: tools.filter((tool) => tool.visible).map((tool) => tool.id),
    more: tools.filter((tool) => !tool.visible).map((tool) => tool.id),
  };
}
