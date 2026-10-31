import { moveCaptureSelection } from "./selectionDrag";
import type { Selection } from "../hooks/useCaptureLifecycle";

export function fullScreenCandidate(width: number, height: number): Selection {
  return { x: 0, y: 0, width, height };
}

/** Work in physical pixels, then map back to the overlay's coordinate system. */
export function nudgeCaptureSelection(
  selection: Selection,
  key: string,
  mode: "move" | "shrink" | "expand",
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  ratio: number | null = null,
): Selection {
  const sx = imageWidth / viewportWidth,
    sy = imageHeight / viewportHeight;
  let x = Math.round(selection.x * sx),
    y = Math.round(selection.y * sy);
  let w = Math.round(selection.width * sx),
    h = Math.round(selection.height * sy);
  const dx = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
  const dy = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
  if (!dx && !dy) return selection;
  if (mode === "move")
    return moveCaptureSelection(
      selection,
      dx / sx,
      dy / sy,
      imageWidth,
      imageHeight,
      viewportWidth,
      viewportHeight,
    );
  else {
    const amount = mode === "expand" ? 1 : -1;
    const nw = dx ? w + amount : ratio ? Math.round((h + amount) * ratio) : w;
    const nh = dy ? h + amount : ratio ? Math.round(nw / ratio) : h;
    const negative = dx < 0 || dy < 0;
    const nx = dx < 0 || (ratio && negative) ? x + w - nw : x;
    const ny = dy < 0 || (ratio && negative) ? y + h - nh : y;
    if (
      nx < 0 ||
      ny < 0 ||
      nx + nw > imageWidth ||
      ny + nh > imageHeight ||
      nw < Math.ceil(8 * sx) ||
      nh < Math.ceil(8 * sy)
    )
      return selection;
    x = nx;
    y = ny;
    w = nw;
    h = nh;
  }
  return { x: x / sx, y: y / sy, width: w / sx, height: h / sy };
}

export function pickerPixel(
  clientX: number,
  clientY: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  return {
    x: Math.max(0, Math.min(width - 1, Math.floor((clientX * width) / viewportWidth))),
    y: Math.max(0, Math.min(height - 1, Math.floor((clientY * height) / viewportHeight))),
  };
}
