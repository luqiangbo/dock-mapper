import type { FrameEffect, FrameShape, GradientStop } from "./annotationTypes";
import { arrowSeed } from "./crayonBrush";
import { decorativePalette, decorativeVariant } from "./framePalette";
import { createCanvasPaint, paintCacheKey } from "./annotationPaint";
import { paintP5Frame } from "./p5FrameRenderer";

export interface FrameBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

const CACHE_LIMIT = 48;
const renderCache = new Map<string, HTMLCanvasElement>();

export function shapeEffectPadding(effect: FrameEffect = "classic", width: number): number {
  return Math.max(
    4,
    width *
      (effect === "watercolor" || effect === "ink"
        ? 3
        : effect === "cartoon" || effect === "decorative"
          ? 2.6
          : effect === "gradient"
            ? 2
            : effect === "classic"
              ? 1
              : 1.6),
  );
}

export function clearShapeRenderCache(): void {
  renderCache.clear();
}

function noise(index: number, seed: number): number {
  let value = Math.imul(index + 1, 0x45d9f3b) ^ seed;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function pointsFor(kind: FrameShape, bounds: FrameBounds, count = 72): Point[] {
  if (kind === "ellipse") {
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    return Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2;
      return {
        x: cx + Math.cos(angle) * bounds.width / 2,
        y: cy + Math.sin(angle) * bounds.height / 2,
      };
    });
  }
  const perimeter = Math.max(1, (bounds.width + bounds.height) * 2);
  return Array.from({ length: count }, (_, index) => {
    const distance = (index / count) * perimeter;
    if (distance < bounds.width) return { x: bounds.x + distance, y: bounds.y };
    if (distance < bounds.width + bounds.height)
      return { x: bounds.x + bounds.width, y: bounds.y + distance - bounds.width };
    if (distance < bounds.width * 2 + bounds.height)
      return { x: bounds.x + bounds.width * 2 + bounds.height - distance, y: bounds.y + bounds.height };
    return { x: bounds.x, y: bounds.y + perimeter - distance };
  });
}

function contourPath(points: Point[], seed = 0, amount = 0): Path2D {
  const path = new Path2D();
  points.forEach((point, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    const next = points[(index + 1) % points.length];
    const length = Math.hypot(next.x - previous.x, next.y - previous.y) || 1;
    const nx = -(next.y - previous.y) / length;
    const ny = (next.x - previous.x) / length;
    const offset = (noise(index, seed) - 0.5) * amount;
    const x = point.x + nx * offset;
    const y = point.y + ny * offset;
    if (index === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });
  path.closePath();
  return path;
}

function rgba(color: string, alpha: number): string {
  const value = color.replace("#", "");
  const hex = value.length === 3 ? [...value].map((part) => part + part).join("") : value;
  const channels = [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  if (channels.some((channel) => !Number.isFinite(channel))) return `rgba(239,68,68,${alpha})`;
  return `rgba(${channels.join(",")},${alpha})`;
}

function drawPattern(
  context: CanvasRenderingContext2D,
  path: Path2D,
  bounds: FrameBounds,
  width: number,
  color: string,
  seed: number,
  fillOpacity: number,
  gradientStops?: GradientStop[],
): void {
  const palette = decorativePalette(color, seed);
  const variant = decorativeVariant(seed);
  context.save();
  context.clip(path);
  context.globalAlpha = fillOpacity;
  context.fillStyle = createCanvasPaint(
    context,
    palette.base,
    gradientStops,
    bounds.x,
    bounds.y,
    bounds.x + bounds.width,
    bounds.y,
  );
  context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  if (variant === "stripes") {
    context.strokeStyle = palette.light;
    context.lineWidth = Math.max(2, width * 1.2);
    const spacing = Math.max(8, width * 3);
    for (let x = bounds.x - bounds.height; x < bounds.x + bounds.width + bounds.height; x += spacing) {
      context.beginPath();
      context.moveTo(x, bounds.y + bounds.height);
      context.lineTo(x + bounds.height, bounds.y);
      context.stroke();
    }
  } else if (variant === "dots") {
    context.fillStyle = palette.light;
    const spacing = Math.max(8, width * 3.2);
    for (let y = bounds.y; y <= bounds.y + bounds.height; y += spacing)
      for (let x = bounds.x; x <= bounds.x + bounds.width; x += spacing) {
        context.beginPath();
        context.arc(x + noise(Math.round(x + y), seed) * spacing * 0.35, y, Math.max(1.5, width * 0.45), 0, Math.PI * 2);
        context.fill();
      }
  } else if (variant === "stitches") {
    context.fillStyle = palette.accent;
    context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  } else if (variant === "color-block") {
    context.fillStyle = palette.accent;
    context.fillRect(bounds.x, bounds.y, bounds.width / 3, bounds.height);
    context.fillStyle = palette.contrast;
    context.fillRect(bounds.x + bounds.width * 0.7, bounds.y, bounds.width * 0.3, bounds.height);
  } else if (variant === "halftone" || variant === "speckles") {
    context.fillStyle = palette.light;
    const spacing = Math.max(5, width * (variant === "halftone" ? 1.45 : 2));
    for (let y = bounds.y; y <= bounds.y + bounds.height; y += spacing)
      for (let x = bounds.x; x <= bounds.x + bounds.width; x += spacing) {
        if (variant === "speckles" && noise(Math.round(x + y), seed) < 0.5) continue;
        context.beginPath();
        context.arc(x, y, Math.max(0.8, width * (variant === "halftone" ? 0.27 : noise(Math.round(x - y), seed) * 0.36)), 0, Math.PI * 2);
        context.fill();
      }
  } else if (variant === "grid") {
    context.strokeStyle = palette.dark;
    context.lineWidth = Math.max(0.8, width * 0.18);
    const spacing = Math.max(6, width * 1.8);
    for (let x = bounds.x; x <= bounds.x + bounds.width; x += spacing) {
      context.beginPath(); context.moveTo(x, bounds.y); context.lineTo(x, bounds.y + bounds.height); context.stroke();
    }
    for (let y = bounds.y; y <= bounds.y + bounds.height; y += spacing) {
      context.beginPath(); context.moveTo(bounds.x, y); context.lineTo(bounds.x + bounds.width, y); context.stroke();
    }
  } else {
    context.strokeStyle = palette.dark;
    context.lineWidth = Math.max(0.8, width * 0.2);
    const spacing = Math.max(7, width * 2.2);
    for (let x = bounds.x - spacing; x <= bounds.x + bounds.width + spacing; x += spacing) {
      context.beginPath();
      for (let step = 0; step <= 16; step += 1) {
        const y = bounds.y + (step / 16) * bounds.height;
        const wave = Math.sin(step * 1.05 + x / spacing) * spacing * (variant === "waves" ? 0.25 : 0.43);
        if (!step) context.moveTo(x + wave, y); else context.lineTo(x + wave, y);
      }
      context.stroke();
    }
  }
  context.restore();
  context.strokeStyle = palette.dark;
  context.lineWidth = width * 1.65;
  context.stroke(path);
  context.strokeStyle = palette.light;
  context.lineWidth = Math.max(1, width * 0.34);
  context.setLineDash(variant === "stitches" ? [width * 1.5, width] : []);
  context.stroke(path);
  context.setLineDash([]);
}

function paint(
  context: CanvasRenderingContext2D,
  kind: FrameShape,
  bounds: FrameBounds,
  color: string,
  width: number,
  fillOpacity: number,
  effect: FrameEffect,
  seed: number,
  gradientStops?: GradientStop[],
): void {
  const points = pointsFor(kind, bounds);
  const clean = contourPath(points);
  const material = createCanvasPaint(
    context,
    color,
    gradientStops,
    bounds.x,
    bounds.y,
    bounds.x + bounds.width,
    bounds.y,
  );
  context.lineCap = "round";
  context.lineJoin = "round";
  if (effect === "classic") {
    if (fillOpacity > 0) {
      context.fillStyle = material;
      context.globalAlpha = fillOpacity;
      context.fill(clean);
      context.globalAlpha = 1;
    }
    context.strokeStyle = material;
    context.lineWidth = width;
    context.stroke(clean);
    return;
  }
  if (effect === "decorative") {
    if (fillOpacity > 0) {
      drawPattern(context, clean, bounds, width, color, seed, fillOpacity, gradientStops);
    } else {
      const palette = decorativePalette(color, seed);
      context.strokeStyle = palette.dark;
      context.lineWidth = width * 1.65;
      context.stroke(clean);
      context.strokeStyle = palette.light;
      context.lineWidth = Math.max(1, width * 0.34);
      context.stroke(clean);
    }
    return;
  }
  if (effect === "cartoon") {
    const palette = decorativePalette(color, seed);
    const depth = Math.max(2, width * 1.25);
    context.save();
    context.translate(depth, depth);
    context.strokeStyle = palette.dark;
    context.lineWidth = width * 2.2;
    context.shadowColor = "rgba(0,0,0,.28)";
    context.shadowBlur = width * 1.4;
    context.stroke(clean);
    context.restore();
    if (fillOpacity > 0) {
      context.fillStyle = material;
      context.globalAlpha = fillOpacity;
      context.fill(clean);
      context.globalAlpha = 1;
    }
    context.strokeStyle = palette.dark;
    context.lineWidth = width * 1.8;
    context.stroke(clean);
    context.strokeStyle = palette.light;
    context.globalAlpha = 0.72;
    context.lineWidth = Math.max(1, width * 0.32);
    context.stroke(clean);
    context.globalAlpha = 1;
    return;
  }
  if (effect === "gradient") {
    const palette = decorativePalette(color, seed);
    const gradient = gradientStops?.length ? material : context.createLinearGradient(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y);
    if (gradient instanceof CanvasGradient && !gradientStops?.length) {
      gradient.addColorStop(0, palette.accent);
      gradient.addColorStop(0.5, color);
      gradient.addColorStop(1, palette.contrast);
    }
    if (fillOpacity > 0) {
      context.globalAlpha = fillOpacity;
      context.fillStyle = gradient;
      context.fill(clean);
      context.globalAlpha = 1;
    }
    context.strokeStyle = gradient;
    context.lineWidth = width * 1.55;
    context.shadowColor = rgba(color, 0.34);
    context.shadowBlur = width * 1.3;
    context.stroke(clean);
    context.shadowBlur = 0;
    context.strokeStyle = "rgba(255,255,255,.5)";
    context.lineWidth = Math.max(0.8, width * 0.24);
    context.stroke(clean);
    return;
  }
  if (effect === "ink") {
    if (fillOpacity > 0) {
      context.fillStyle = material;
      context.globalAlpha = fillOpacity * 0.24;
      context.fill(contourPath(points, seed ^ 0x318d, width * 1.2));
      context.globalAlpha = 1;
    }
    for (let pass = 0; pass < 5; pass += 1) {
      context.strokeStyle = pass === 4 ? material : `rgba(18,20,22,${0.12 + pass * 0.055})`;
      context.globalAlpha = pass === 4 ? 0.18 : 1;
      context.lineWidth = width * (0.5 + noise(pass, seed) * 0.85);
      context.setLineDash(pass === 2 ? [width * 2.5, width * 0.7] : []);
      context.stroke(contourPath(points, seed + pass * 149, width * 0.9));
    }
    context.setLineDash([]);
    context.globalAlpha = 0.34;
    context.fillStyle = "#111315";
    for (let dot = 0; dot < 7; dot += 1) {
      const side = dot % 2 ? -1 : 1;
      const x = bounds.x + noise(dot, seed) * bounds.width;
      const y = side > 0 ? bounds.y - width * (0.8 + noise(dot + 30, seed)) : bounds.y + bounds.height + width;
      context.beginPath();
      context.arc(x, y, Math.max(0.6, width * noise(dot + 70, seed) * 0.24), 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    return;
  }
  if (effect === "watercolor") {
    for (let layer = 0; layer < 12; layer += 1) {
      const wet = contourPath(points, seed + layer * 97, width * (0.55 + layer * 0.035));
      if (fillOpacity > 0) {
        context.fillStyle = layer % 3 === 0 && !gradientStops?.length
          ? decorativePalette(color, seed).accent
          : material;
        context.globalAlpha = fillOpacity / 7;
        context.fill(wet);
        context.globalAlpha = 1;
      }
      context.strokeStyle = material;
      context.globalAlpha = 0.055 + noise(layer, seed) * 0.065;
      context.lineWidth = width * (0.75 + noise(layer + 20, seed) * 0.7);
      context.stroke(wet);
      context.globalAlpha = 1;
    }
    context.strokeStyle = material;
    context.globalAlpha = 0.42;
    context.lineWidth = width * 0.65;
    context.stroke(contourPath(points, seed ^ 0x7319, width * 0.45));
    context.globalAlpha = 1;
    return;
  }
  if (fillOpacity > 0) {
    context.fillStyle = material;
    context.globalAlpha = fillOpacity;
    context.fill(clean);
    context.globalAlpha = 1;
  }
  if (effect === "handdrawn") {
    for (let pass = 0; pass < 2; pass += 1) {
      context.strokeStyle = material;
      context.globalAlpha = pass ? 0.55 : 0.9;
      context.lineWidth = width * (pass ? 0.7 : 1);
      context.stroke(contourPath(points, seed + pass * 173, width * 0.45));
    }
    context.globalAlpha = 1;
    return;
  }
  context.strokeStyle = material;
  context.globalAlpha = 0.72;
  context.lineWidth = width * 1.2;
  context.stroke(contourPath(points, seed, width * 0.7));
  context.globalAlpha = 1;
  context.lineWidth = Math.max(0.7, width * 0.38);
  for (let pass = 0; pass < 3; pass += 1) {
    context.strokeStyle = rgba(pass === 1 ? decorativePalette(color, seed).accent : color, 0.36);
    context.setLineDash([Math.max(1, width * (0.7 + pass * 0.25)), Math.max(1, width * 0.45)]);
    context.lineDashOffset = noise(pass, seed) * width * 4;
    context.stroke(contourPath(points, seed + pass * 211, width));
  }
  context.setLineDash([]);
}

export function drawStyledFrame(
  context: CanvasRenderingContext2D,
  kind: FrameShape,
  bounds: FrameBounds,
  color: string,
  width: number,
  fillOpacity: number,
  effect: FrameEffect,
  canvasScale: number,
  id: string,
  gradientStops?: GradientStop[],
): void {
  const padding = shapeEffectPadding(effect, width);
  const cacheKey = [
    "p5-rough-v1",
    id,
    kind,
    bounds.width,
    bounds.height,
    color,
    width,
    fillOpacity,
    effect,
    canvasScale,
    paintCacheKey(gradientStops),
  ].join("|");
  let canvas = renderCache.get(cacheKey);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(bounds.width + padding * 2));
    canvas.height = Math.max(1, Math.ceil(bounds.height + padding * 2));
    const brush = canvas.getContext("2d");
    if (!brush) throw new Error("框选效果渲染失败：无法创建画布，请重试");
    const localBounds = { x: padding, y: padding, width: bounds.width, height: bounds.height };
    const seed = arrowSeed(`${id}:${kind}`);
    if (
      !paintP5Frame(
        brush,
        kind,
        localBounds,
        color,
        width,
        fillOpacity,
        effect,
        seed,
        gradientStops,
      )
    ) {
      brush.clearRect(0, 0, canvas.width, canvas.height);
      paint(
        brush,
        kind,
        localBounds,
        color,
        width,
        fillOpacity,
        effect,
        seed,
        gradientStops,
      );
    }
    renderCache.set(cacheKey, canvas);
    if (renderCache.size > CACHE_LIMIT) renderCache.delete(renderCache.keys().next().value!);
  }
  context.drawImage(canvas, bounds.x - padding, bounds.y - padding);
}
