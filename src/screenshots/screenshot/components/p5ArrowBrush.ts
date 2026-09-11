import type { ArrowBrushPaintOptions } from "./arrowBrushRenderer";
import type { ArrowGeometry } from "./arrowShapes";
import { arrowLineParts } from "./arrowAssembly";
import { brush, paintP5Mask } from "./p5BrushService";

interface BrushDefinition {
  engine: "stroke" | "hatch";
  name: string;
  baseWeight: number;
}

const DEFINITIONS: Record<Exclude<ArrowBrushPaintOptions["brushId"], "solid">, BrushDefinition> = {
  marker: { engine: "stroke", name: "dock-marker", baseWeight: 2 },
  highlighter: { engine: "stroke", name: "dock-highlighter", baseWeight: 2.4 },
  "brush-pen": { engine: "stroke", name: "pen", baseWeight: 0.3 },
  pencil: { engine: "stroke", name: "HB", baseWeight: 0.65 },
  charcoal: { engine: "stroke", name: "charcoal", baseWeight: 1.2 },
  watercolor: { engine: "stroke", name: "dock-watercolor", baseWeight: 0.62 },
  spray: { engine: "stroke", name: "spray", baseWeight: 6 },
  hatch: { engine: "hatch", name: "HB", baseWeight: 0.65 },
};

function drawStrokeGeometry(geometry: ArrowGeometry, definition: BrushDefinition, width: number): void {
  brush.set(definition.name, "#000000", width / definition.baseWeight);
  brush.noFill();
  brush.noHatch();
  brush.noWash();
  for (const part of arrowLineParts(geometry))
    brush.line(part.start.x, part.start.y, part.end.x, part.end.y);
}

function drawHatchGeometry(geometry: ArrowGeometry, width: number): void {
  brush.set("HB", "#000000", Math.max(0.75, width * 0.8));
  brush.noFill();
  brush.noHatch();
  brush.noWash();
  for (const part of arrowLineParts(geometry)) {
    const length = Math.hypot(part.end.x - part.start.x, part.end.y - part.start.y) || 1;
    const nx = -(part.end.y - part.start.y) / length;
    const ny = (part.end.x - part.start.x) / length;
    for (const offset of [-0.34, 0, 0.34]) {
      const amount = offset * width;
      brush.line(
        part.start.x + nx * amount,
        part.start.y + ny * amount,
        part.end.x + nx * amount,
        part.end.y + ny * amount,
      );
    }
  }
}

/** Paints all arrow recipes as straight, independently brushable components. */
export function paintP5ArrowMask(
  context: CanvasRenderingContext2D,
  geometry: ArrowGeometry,
  options: ArrowBrushPaintOptions,
): boolean {
  if (options.brushId === "solid") return false;
  return paintP5Mask(context, options.seed, () => {
    const definition = DEFINITIONS[
      options.brushId as Exclude<ArrowBrushPaintOptions["brushId"], "solid">
    ];
    if (definition.engine === "hatch") drawHatchGeometry(geometry, options.width);
    else drawStrokeGeometry(geometry, definition, options.width);
  });
}
