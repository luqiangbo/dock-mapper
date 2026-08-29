import type { NumberStyle } from "./annotationTypes";

export interface NumberObject {
  id: string;
  value: number;
  canvasX: number;
  canvasY: number;
  style: NumberStyle;
}

export function nextAvailableNumber(objects: ReadonlyArray<Pick<NumberObject, "value">>): number {
  const used = new Set(objects.map((item) => item.value));
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}

export function appendNumberObject(
  objects: ReadonlyArray<NumberObject>,
  object: Omit<NumberObject, "value">,
): NumberObject[] {
  return [...objects, { ...object, value: nextAvailableNumber(objects) }];
}

export function isNumberObjectInteractive(tool: string | null): boolean {
  return tool === "number";
}

export function clampNumberCenter(
  canvasX: number,
  canvasY: number,
  radius: number,
  canvasWidth: number,
  canvasHeight: number,
): { canvasX: number; canvasY: number } {
  const safeRadius = Math.max(0, radius);
  const minX = Math.min(safeRadius, canvasWidth / 2);
  const minY = Math.min(safeRadius, canvasHeight / 2);
  return {
    canvasX: Math.max(minX, Math.min(canvasX, canvasWidth - minX)),
    canvasY: Math.max(minY, Math.min(canvasY, canvasHeight - minY)),
  };
}

export function translateNumberObjects(
  objects: ReadonlyArray<NumberObject>,
  dx: number,
  dy: number,
): NumberObject[] {
  return objects.map((item) => ({
    ...item,
    canvasX: item.canvasX + dx,
    canvasY: item.canvasY + dy,
  }));
}
