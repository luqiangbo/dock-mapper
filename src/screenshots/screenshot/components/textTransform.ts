export const TEXT_RESIZE_HANDLES = ["nw", "ne", "sw", "se"] as const;
export type TextResizeHandle = (typeof TEXT_RESIZE_HANDLES)[number];

export interface TextTransformBox {
  canvasX: number;
  canvasY: number;
  width: number;
  height: number;
  fontSize: number;
  transformScale: number;
}

export function resizeTextBox(
  origin: TextTransformBox,
  handle: TextResizeHandle,
  pointerX: number,
  pointerY: number,
  canvasWidth: number,
  canvasHeight: number,
): Pick<TextTransformBox, "canvasX" | "canvasY" | "transformScale"> {
  const renderedWidth = origin.width * origin.transformScale;
  const renderedHeight = origin.height * origin.transformScale;
  const anchorX = handle.includes("w") ? origin.canvasX + renderedWidth : origin.canvasX;
  const anchorY = handle.includes("n") ? origin.canvasY + renderedHeight : origin.canvasY;
  const startX = handle.includes("w") ? origin.canvasX : origin.canvasX + renderedWidth;
  const startY = handle.includes("n") ? origin.canvasY : origin.canvasY + renderedHeight;
  const startDistance = Math.max(1, Math.hypot(startX - anchorX, startY - anchorY));
  const distance = Math.hypot(pointerX - anchorX, pointerY - anchorY);
  const minScale = 8 / Math.max(1, origin.fontSize);
  const maxScale = 160 / Math.max(1, origin.fontSize);
  let transformScale = Math.min(
    maxScale,
    Math.max(minScale, (origin.transformScale * distance) / startDistance),
  );
  transformScale = Math.min(
    transformScale,
    canvasWidth / Math.max(1, origin.width),
    canvasHeight / Math.max(1, origin.height),
  );
  const width = origin.width * transformScale;
  const height = origin.height * transformScale;
  const canvasX = Math.max(
    0,
    Math.min(handle.includes("w") ? anchorX - width : anchorX, canvasWidth - width),
  );
  const canvasY = Math.max(
    0,
    Math.min(handle.includes("n") ? anchorY - height : anchorY, canvasHeight - height),
  );
  return { canvasX, canvasY, transformScale };
}
