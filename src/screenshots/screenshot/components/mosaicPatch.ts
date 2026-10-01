export interface MosaicPoint {
  x: number;
  y: number;
}
export interface MosaicBounds extends MosaicPoint {
  width: number;
  height: number;
}

/** Clamp in bitmap coordinates, including reverse drags and off-canvas input. */
export function mosaicBounds(
  start: MosaicPoint,
  end: MosaicPoint,
  width: number,
  height: number,
): MosaicBounds {
  const left = Math.max(0, Math.min(width, Math.floor(Math.min(start.x, end.x))));
  const top = Math.max(0, Math.min(height, Math.floor(Math.min(start.y, end.y))));
  const right = Math.max(left, Math.min(width, Math.ceil(Math.max(start.x, end.x))));
  const bottom = Math.max(top, Math.min(height, Math.ceil(Math.max(start.y, end.y))));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function mosaicBlockPixels(blockSize: number, zoom: number) {
  return Math.max(2, Math.round(blockSize / Math.max(Number.EPSILON, zoom)));
}

export function mosaicGrid(width: number, height: number, blockSize: number, zoom: number) {
  const block = mosaicBlockPixels(blockSize, zoom);
  return {
    width: Math.max(1, Math.ceil(width / block)),
    height: Math.max(1, Math.ceil(height / block)),
  };
}

/** Read whole grid cells so partial selections and overlapping patches agree. */
export function mosaicSampleBounds(
  bounds: MosaicBounds,
  width: number,
  height: number,
  block: number,
): MosaicBounds {
  const x = Math.floor(bounds.x / block) * block;
  const y = Math.floor(bounds.y / block) * block;
  return {
    x,
    y,
    width: Math.min(width, Math.ceil((bounds.x + bounds.width) / block) * block) - x,
    height: Math.min(height, Math.ceil((bounds.y + bounds.height) / block) * block) - y,
  };
}

/** Average premultiplied color; transparent RGB never bleeds into a cell. */
export function pixelatePixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  block: number,
): Uint8ClampedArray<ArrayBuffer> {
  const output = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y += block) {
    for (let x = 0; x < width; x += block) {
      const right = Math.min(width, x + block);
      const bottom = Math.min(height, y + block);
      let red = 0,
        green = 0,
        blue = 0,
        alpha = 0;
      for (let row = y; row < bottom; row++) {
        for (let col = x; col < right; col++) {
          const offset = (row * width + col) * 4;
          const a = data[offset + 3];
          red += data[offset] * a;
          green += data[offset + 1] * a;
          blue += data[offset + 2] * a;
          alpha += a;
        }
      }
      const color = [
        alpha ? red / alpha : 0,
        alpha ? green / alpha : 0,
        alpha ? blue / alpha : 0,
        alpha / ((right - x) * (bottom - y)),
      ];
      for (let col = x; col < right; col++) output.set(color, (y * width + col) * 4);
      const firstRow = (y * width + x) * 4;
      for (let row = y + 1; row < bottom; row++) {
        output.copyWithin((row * width + x) * 4, firstRow, firstRow + (right - x) * 4);
      }
    }
  }
  return output;
}
