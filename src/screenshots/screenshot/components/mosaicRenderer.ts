import type { MosaicEffect } from "../../../types";
import {
  mosaicBlockPixels,
  mosaicSampleBounds,
  pixelatePixels,
  type MosaicBounds,
} from "./mosaicPatch";

let blurCapability: boolean | undefined;
export function supportsCanvasBlur(): boolean {
  if (blurCapability !== undefined) return blurCapability;
  return (blurCapability = detectCanvasBlur());
}

export function detectCanvasBlur(createCanvas = () => document.createElement("canvas")): boolean {
  try {
    const source = createCanvas();
    source.width = 8;
    source.height = 8;
    const input = source.getContext("2d");
    const target = createCanvas();
    target.width = 8;
    target.height = 8;
    const output = target.getContext("2d");
    if (!input || !output || !("filter" in output)) return false;
    input.fillStyle = "black";
    input.fillRect(0, 0, 8, 8);
    input.fillStyle = "white";
    input.fillRect(4, 0, 4, 8);
    output.filter = "blur(1px)";
    output.drawImage(source, 0, 0);
    const pixel = output.getImageData(3, 4, 1, 1).data;
    return pixel[0] > 0 && pixel[0] < 255;
  } catch {
    // The UI disables blur and displays the capability failure explicitly.
    return false;
  }
}

export function blurSampleArea(
  bounds: MosaicBounds,
  width: number,
  height: number,
  radius: number,
) {
  const padding = Math.ceil(radius * 4);
  const left = bounds.x - padding,
    top = bounds.y - padding;
  const x = Math.max(0, left),
    y = Math.max(0, top);
  const right = Math.min(width, bounds.x + bounds.width + padding);
  const bottom = Math.min(height, bounds.y + bounds.height + padding);
  return {
    padding,
    x,
    y,
    width: right - x,
    height: bottom - y,
    targetX: x - left,
    targetY: y - top,
    targetWidth: bounds.width + 2 * padding,
    targetHeight: bounds.height + 2 * padding,
  };
}

function context(canvas: HTMLCanvasElement) {
  const value = canvas.getContext("2d");
  if (!value) throw new Error("马赛克画布不可用");
  return value;
}
function resize(canvas: HTMLCanvasElement, width: number, height: number) {
  canvas.width = width;
  canvas.height = height;
}

/** Scratch canvases are reused; the returned patch is copied or encoded immediately. */
export class MosaicRenderer {
  private patch = document.createElement("canvas");
  private sample = document.createElement("canvas");
  private filtered = document.createElement("canvas");

  render(
    base: HTMLCanvasElement,
    bounds: MosaicBounds,
    effect: MosaicEffect,
    strength: number,
    zoom: number,
  ): HTMLCanvasElement {
    resize(this.patch, bounds.width, bounds.height);
    const output = context(this.patch);
    if (effect === "pixelate") {
      const block = mosaicBlockPixels(strength, zoom);
      const area = mosaicSampleBounds(bounds, base.width, base.height, block);
      const pixels = context(base).getImageData(area.x, area.y, area.width, area.height);
      const colors = pixelatePixels(pixels.data, area.width, area.height, block);
      resize(this.sample, area.width, area.height);
      context(this.sample).putImageData(new ImageData(colors, area.width, area.height), 0, 0);
      output.drawImage(
        this.sample,
        bounds.x - area.x,
        bounds.y - area.y,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height,
      );
    } else {
      if (!supportsCanvasBlur()) throw new Error("当前环境不支持柔和模糊，请选择像素块");
      const radius = Math.max(1, strength / zoom);
      const area = blurSampleArea(bounds, base.width, base.height, radius);
      resize(this.sample, area.targetWidth, area.targetHeight);
      const input = context(this.sample);
      input.imageSmoothingEnabled = false;
      input.drawImage(
        base,
        area.x,
        area.y,
        area.width,
        area.height,
        area.targetX,
        area.targetY,
        area.width,
        area.height,
      );
      // Extend real edge pixels, rather than introducing transparent padding.
      if (area.targetX)
        input.drawImage(
          base,
          0,
          area.y,
          1,
          area.height,
          0,
          area.targetY,
          area.targetX,
          area.height,
        );
      const right = area.targetX + area.width;
      if (right < area.targetWidth)
        input.drawImage(
          base,
          base.width - 1,
          area.y,
          1,
          area.height,
          right,
          area.targetY,
          area.targetWidth - right,
          area.height,
        );
      if (area.targetY)
        input.drawImage(
          this.sample,
          0,
          area.targetY,
          area.targetWidth,
          1,
          0,
          0,
          area.targetWidth,
          area.targetY,
        );
      const bottom = area.targetY + area.height;
      if (bottom < area.targetHeight)
        input.drawImage(
          this.sample,
          0,
          bottom - 1,
          area.targetWidth,
          1,
          0,
          bottom,
          area.targetWidth,
          area.targetHeight - bottom,
        );
      resize(this.filtered, area.targetWidth, area.targetHeight);
      const filtered = context(this.filtered);
      filtered.filter = `blur(${radius}px)`;
      filtered.drawImage(this.sample, 0, 0);
      filtered.filter = "none";
      output.drawImage(
        this.filtered,
        area.padding,
        area.padding,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height,
      );
    }
    return this.patch;
  }

  release() {
    for (const canvas of [this.patch, this.sample, this.filtered]) resize(canvas, 0, 0);
  }
}
