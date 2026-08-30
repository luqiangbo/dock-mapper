import type { Selection } from "../hooks/useCaptureLifecycle";
import { calculateSelectionCrop, MIN_SELECTION_SIZE } from "./selectionGeometry";

export interface OutputSize {
  width: number;
  height: number;
}

export interface OutputSizeLimits {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
}

export interface PanelPosition {
  left: number;
  top: number;
}

const VIEWPORT_MARGIN = 8;
const SELECTION_GAP = 8;

export function getOutputSizeLimits(
  selection: Selection,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): OutputSizeLimits {
  const scaleX = imageWidth / Math.max(1, viewportWidth);
  const scaleY = imageHeight / Math.max(1, viewportHeight);
  return {
    minWidth: Math.ceil(MIN_SELECTION_SIZE * scaleX),
    maxWidth: Math.max(
      Math.ceil(MIN_SELECTION_SIZE * scaleX),
      Math.round(Math.max(0, viewportWidth - selection.x) * scaleX),
    ),
    minHeight: Math.ceil(MIN_SELECTION_SIZE * scaleY),
    maxHeight: Math.max(
      Math.ceil(MIN_SELECTION_SIZE * scaleY),
      Math.round(Math.max(0, viewportHeight - selection.y) * scaleY),
    ),
  };
}

/**
 * Translates exported PNG pixel dimensions back to the overlay's logical
 * selection. The top-left remains unchanged; only the right and bottom edges
 * move. Invalid values deliberately return null instead of silently clamping.
 */
export function resizeSelectionToOutputSize(
  selection: Selection,
  requested: Partial<OutputSize>,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): Selection | null {
  const current = calculateSelectionCrop(
    selection,
    imageWidth,
    imageHeight,
    viewportWidth,
    viewportHeight,
  );
  const limits = getOutputSizeLimits(
    selection,
    imageWidth,
    imageHeight,
    viewportWidth,
    viewportHeight,
  );
  const width = requested.width ?? current.outputWidth;
  const height = requested.height ?? current.outputHeight;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < limits.minWidth ||
    width > limits.maxWidth ||
    height < limits.minHeight ||
    height > limits.maxHeight
  ) {
    return null;
  }

  const scaleX = imageWidth / Math.max(1, viewportWidth);
  const scaleY = imageHeight / Math.max(1, viewportHeight);
  const availableWidth = Math.max(MIN_SELECTION_SIZE, viewportWidth - selection.x);
  const availableHeight = Math.max(MIN_SELECTION_SIZE, viewportHeight - selection.y);
  return {
    x: selection.x,
    y: selection.y,
    width: width === limits.maxWidth ? availableWidth : width / scaleX,
    height: height === limits.maxHeight ? availableHeight : height / scaleY,
  };
}

export function calculateSelectionSizePanelPosition(
  selection: Selection,
  panelSize: { width: number; height: number },
  viewportSize: { width: number; height: number },
): PanelPosition {
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewportSize.width - panelSize.width - VIEWPORT_MARGIN);
  const maxTop = Math.max(VIEWPORT_MARGIN, viewportSize.height - panelSize.height - VIEWPORT_MARGIN);
  const left = Math.min(Math.max(selection.x, VIEWPORT_MARGIN), maxLeft);
  const above = selection.y - SELECTION_GAP - panelSize.height;
  const top = above >= VIEWPORT_MARGIN
    ? above
    : Math.min(Math.max(selection.y + selection.height + SELECTION_GAP, VIEWPORT_MARGIN), maxTop);
  return { left, top };
}
