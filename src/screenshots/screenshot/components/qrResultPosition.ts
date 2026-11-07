/** Map decoded image pixels to the displayed selection, keeping edge labels inside it. */
export function qrResultPosition(
  code: { centerX: number; centerY: number },
  image: { width: number; height: number },
  display: { width: number; height: number },
) {
  const width = Math.max(1, Math.min(220, display.width - 12));
  const clamp = (value: number, extent: number, padding: number) => {
    const inset = Math.min(extent / 2, padding);
    return Math.max(inset, Math.min(extent - inset, value));
  };
  return {
    left: clamp(
      (code.centerX / Math.max(1, image.width)) * display.width,
      display.width,
      width / 2 + 6,
    ),
    top: clamp((code.centerY / Math.max(1, image.height)) * display.height, display.height, 34),
    width,
  };
}
