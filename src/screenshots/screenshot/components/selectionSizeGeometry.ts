import type { Selection } from "../hooks/useCaptureLifecycle";
import { calculateSelectionCrop, MIN_SELECTION_SIZE } from "./selectionGeometry";

export interface OutputSize {
  width: number;
  height: number;
}

export type CaptureSizeUnit = "px" | "dip";

export interface AspectRatio {
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

function scales(imageWidth: number, imageHeight: number, viewportWidth: number, viewportHeight: number) {
  return {
    x: imageWidth / Math.max(1, viewportWidth),
    y: imageHeight / Math.max(1, viewportHeight),
  };
}

export function normalizeAspectRatio(width: number, height: number): AspectRatio | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

export function getSelectionSize(
  selection: Selection,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  unit: CaptureSizeUnit,
): OutputSize {
  if (unit === "dip") return { width: selection.width, height: selection.height };
  const crop = calculateSelectionCrop(selection, imageWidth, imageHeight, viewportWidth, viewportHeight);
  return { width: crop.outputWidth, height: crop.outputHeight };
}

export function getSelectionSizeLimits(
  selection: Selection,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  unit: CaptureSizeUnit,
): OutputSizeLimits {
  if (unit === "px")
    return getOutputSizeLimits(selection, imageWidth, imageHeight, viewportWidth, viewportHeight);
  return {
    minWidth: MIN_SELECTION_SIZE,
    minHeight: MIN_SELECTION_SIZE,
    maxWidth: Math.max(MIN_SELECTION_SIZE, viewportWidth - selection.x),
    maxHeight: Math.max(MIN_SELECTION_SIZE, viewportHeight - selection.y),
  };
}

export function getOutputSizeLimits(
  selection: Selection,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): OutputSizeLimits {
  const { x: scaleX, y: scaleY } = scales(imageWidth, imageHeight, viewportWidth, viewportHeight);
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

  const { x: scaleX, y: scaleY } = scales(imageWidth, imageHeight, viewportWidth, viewportHeight);
  const availableWidth = Math.max(MIN_SELECTION_SIZE, viewportWidth - selection.x);
  const availableHeight = Math.max(MIN_SELECTION_SIZE, viewportHeight - selection.y);
  return {
    x: selection.x,
    y: selection.y,
    width: width === limits.maxWidth ? availableWidth : width / scaleX,
    height: height === limits.maxHeight ? availableHeight : height / scaleY,
  };
}

/**
 * Converts a size-panel value into a new crop.  The selection's top-left is
 * never moved.  An aspect ratio is defined in exported PNG pixels, so uneven
 * X/Y DPI scales still produce the requested visual ratio.
 */
export function resizeSelectionToSize(
  selection: Selection,
  requested: Partial<OutputSize>,
  unit: CaptureSizeUnit,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  aspectRatio: AspectRatio | null = null,
): Selection | null {
  const current = getSelectionSize(
    selection,
    imageWidth,
    imageHeight,
    viewportWidth,
    viewportHeight,
    unit,
  );
  const requestedWidth = requested.width ?? current.width;
  const requestedHeight = requested.height ?? current.height;
  const limits = getSelectionSizeLimits(
    selection,
    imageWidth,
    imageHeight,
    viewportWidth,
    viewportHeight,
    unit,
  );
  const precision = unit === "px" ? 1 : 10;
  if (
    !Number.isFinite(requestedWidth) ||
    !Number.isFinite(requestedHeight) ||
    Math.round(requestedWidth * precision) !== requestedWidth * precision ||
    Math.round(requestedHeight * precision) !== requestedHeight * precision
  )
    return null;

  let width = requestedWidth;
  let height = requestedHeight;
  const changingWidth = requested.width !== undefined && requested.height === undefined;
  if (aspectRatio) {
    const scale = scales(imageWidth, imageHeight, viewportWidth, viewportHeight);
    if (changingWidth) height = (width * scale.x * aspectRatio.height) / (scale.y * aspectRatio.width);
    else width = (height * scale.y * aspectRatio.width) / (scale.x * aspectRatio.height);
    if (unit === "px") {
      // Canvas dimensions are integral. Round only the derived side so the
      // typed side stays predictable and the final ratio remains within 1px.
      if (changingWidth) height = Math.round(height);
      else width = Math.round(width);
    } else {
      width = Math.round(width * 10) / 10;
      height = Math.round(height * 10) / 10;
    }
  }
  if (width < limits.minWidth || width > limits.maxWidth || height < limits.minHeight || height > limits.maxHeight)
    return null;

  if (unit === "px")
    return resizeSelectionToOutputSize(
      selection,
      { width, height },
      imageWidth,
      imageHeight,
      viewportWidth,
      viewportHeight,
    );
  return { x: selection.x, y: selection.y, width, height };
}

/** Shrinks the current crop to a physical-pixel aspect ratio, retaining its top-left. */
export function fitSelectionToAspectRatio(
  selection: Selection,
  aspectRatio: AspectRatio,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): Selection | null {
  const scale = scales(imageWidth, imageHeight, viewportWidth, viewportHeight);
  const outputWidth = selection.width * scale.x;
  const outputHeight = selection.height * scale.y;
  const ratio = aspectRatio.width / aspectRatio.height;
  const constrainedWidth = Math.min(outputWidth, outputHeight * ratio);
  const constrainedHeight = constrainedWidth / ratio;
  const next = {
    x: selection.x,
    y: selection.y,
    width: constrainedWidth / scale.x,
    height: constrainedHeight / scale.y,
  };
  return next.width >= MIN_SELECTION_SIZE && next.height >= MIN_SELECTION_SIZE ? next : null;
}

/** Creates a ratio-locked rectangle from an anchor and a moving corner. */
export function selectWithAspectRatio(
  anchor: { x: number; y: number },
  point: { x: number; y: number },
  aspectRatio: AspectRatio,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): Selection {
  const scale = scales(imageWidth, imageHeight, viewportWidth, viewportHeight);
  const signX = point.x < anchor.x ? -1 : 1;
  const signY = point.y < anchor.y ? -1 : 1;
  const requestedWidth = Math.max(
    Math.abs(point.x - anchor.x) * scale.x,
    Math.abs(point.y - anchor.y) * scale.y * (aspectRatio.width / aspectRatio.height),
  );
  const maxWidth = Math.min(
    (signX > 0 ? viewportWidth - anchor.x : anchor.x) * scale.x,
    (signY > 0 ? viewportHeight - anchor.y : anchor.y) * scale.y * (aspectRatio.width / aspectRatio.height),
  );
  const physicalWidth = Math.max(0, Math.min(requestedWidth, maxWidth));
  const width = physicalWidth / scale.x;
  const height = (physicalWidth * aspectRatio.height) / (aspectRatio.width * scale.y);
  return {
    x: signX > 0 ? anchor.x : anchor.x - width,
    y: signY > 0 ? anchor.y : anchor.y - height,
    width,
    height,
  };
}

export function resizeSelectionWithAspectRatio(
  origin: Selection,
  handle: "nw" | "ne" | "sw" | "se",
  dx: number,
  dy: number,
  aspectRatio: AspectRatio,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): Selection {
  const anchor = {
    x: handle.includes("w") ? origin.x + origin.width : origin.x,
    y: handle.includes("n") ? origin.y + origin.height : origin.y,
  };
  const point = {
    x: handle.includes("w") ? origin.x + dx : origin.x + origin.width + dx,
    y: handle.includes("n") ? origin.y + dy : origin.y + origin.height + dy,
  };
  const next = selectWithAspectRatio(
    anchor,
    point,
    aspectRatio,
    imageWidth,
    imageHeight,
    viewportWidth,
    viewportHeight,
  );
  return next.width >= MIN_SELECTION_SIZE && next.height >= MIN_SELECTION_SIZE ? next : origin;
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
