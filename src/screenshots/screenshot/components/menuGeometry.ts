export function clampMenuPosition(
  anchor: { left: number; top: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  return {
    left: Math.max(8, Math.min(anchor.left, viewport.width - size.width - 8)),
    top: Math.max(8, Math.min(anchor.top, viewport.height - size.height - 8)),
  };
}
