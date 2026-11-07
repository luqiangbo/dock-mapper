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

export interface MosaicNoise {
  seed: number;
  originX: number;
  originY: number;
}

function cellNoise(seed: number, x: number, y: number, block: number) {
  let value =
    seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(block, 0xc2b2ae35);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000;
}

/** Optional stable noise suppresses source contrast without per-frame flicker.
 * This is a visual obfuscation effect, not irreversible redaction. */
export function pixelatePixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  block: number,
  noise?: MosaicNoise,
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
      if (noise) {
        const neutral =
          48 +
          cellNoise(noise.seed, (noise.originX + x) / block, (noise.originY + y) / block, block) *
            160;
        for (let channel = 0; channel < 3; channel++)
          color[channel] = color[channel] * 0.15 + neutral * 0.85;
        color[3] = 255;
      }
      for (let col = x; col < right; col++) output.set(color, (y * width + col) * 4);
      const firstRow = (y * width + x) * 4;
      for (let row = y + 1; row < bottom; row++) {
        output.copyWithin((row * width + x) * 4, firstRow, firstRow + (right - x) * 4);
      }
    }
  }
  return output;
}
