export interface ToolbarRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ToolbarSize {
  width: number;
  height: number;
}

export interface ToolbarPosition {
  left: number;
  top: number;
}

export interface ToolbarLayout {
  placement: "above" | "below";
  primary: ToolbarPosition;
  secondary?: ToolbarPosition;
}

const VIEWPORT_MARGIN = 8;
const SELECTION_GAP = 12;
const TOOLBAR_GAP = 6;

function centeredLeft(center: number, width: number, viewportWidth: number): number {
  return Math.min(
    Math.max(VIEWPORT_MARGIN, center - width / 2),
    Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN),
  );
}

export function calculateToolbarLayout(
  selection: ToolbarRect,
  viewport: ToolbarSize,
  primary: ToolbarSize,
  secondary?: ToolbarSize,
): ToolbarLayout {
  const secondaryHeight = secondary ? TOOLBAR_GAP + secondary.height : 0;
  const totalHeight = primary.height + secondaryHeight;
  const belowTop = selection.y + selection.height + SELECTION_GAP;
  const aboveTop = selection.y - SELECTION_GAP - totalHeight;
  const placement =
    belowTop + totalHeight <= viewport.height - VIEWPORT_MARGIN || aboveTop < VIEWPORT_MARGIN
      ? "below"
      : "above";
  const top = Math.min(
    Math.max(VIEWPORT_MARGIN, placement === "below" ? belowTop : aboveTop),
    Math.max(VIEWPORT_MARGIN, viewport.height - totalHeight - VIEWPORT_MARGIN),
  );
  const center = selection.x + selection.width / 2;
  return {
    placement,
    primary: {
      left: centeredLeft(center, primary.width, viewport.width),
      top,
    },
    secondary: secondary
      ? {
          left: centeredLeft(center, secondary.width, viewport.width),
          top: top + primary.height + TOOLBAR_GAP,
        }
      : undefined,
  };
}

export function shouldCompactToolbar(viewportWidth: number, expandedWidth: number): boolean {
  return viewportWidth < 680 || expandedWidth > viewportWidth - VIEWPORT_MARGIN * 2;
}
