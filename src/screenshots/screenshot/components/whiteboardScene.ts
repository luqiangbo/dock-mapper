import type { NumberObject } from "./numberObjects";
import type { RasterAnnotation, SceneBounds, ScenePoint } from "./annotationScene";
import { annotationBounds, cloneRasterAnnotations, hitTestAnnotation } from "./annotationScene";
import type { TextObject } from "./textTypes";

export type SceneElement =
  | { type: "raster"; id: string; value: RasterAnnotation }
  | { type: "text"; id: string; value: TextObject }
  | { type: "number"; id: string; value: NumberObject };
export type SceneValue = RasterAnnotation | TextObject | NumberObject;

export interface SceneObjectSnapshot {
  elements: SceneElement[];
}

export function sceneElement(value: RasterAnnotation | TextObject | NumberObject): SceneElement {
  if ("kind" in value) return { type: "raster", id: value.id, value };
  if ("text" in value) return { type: "text", id: value.id, value };
  return { type: "number", id: value.id, value };
}

export function cloneSceneElements(elements: SceneElement[]): SceneElement[] {
  return elements.map((element) => {
    if (element.type === "raster") return sceneElement(cloneRasterAnnotations([element.value])[0]);
    if (element.type === "text") return sceneElement({ ...element.value });
    return sceneElement({
      ...element.value,
      style: { ...element.value.style, outline: { ...element.value.style.outline } },
    });
  });
}

export function replaceSceneType(
  elements: SceneElement[],
  type: SceneElement["type"],
  values: SceneValue[],
): SceneElement[] {
  const replacements = new Map(values.map((value) => [value.id, sceneElement(value)]));
  const next: SceneElement[] = [];
  for (const element of elements) {
    if (element.type !== type) {
      next.push(element);
      continue;
    }
    const replacement = replacements.get(element.id);
    if (replacement) {
      next.push(replacement);
      replacements.delete(element.id);
    }
  }
  for (const value of values) {
    const replacement = replacements.get(value.id);
    if (replacement) {
      next.push(replacement);
      replacements.delete(value.id);
    }
  }
  return next;
}

function unrotatedSceneBounds(element: SceneElement): SceneBounds {
  if (element.type === "raster") return annotationBounds({ ...element.value, angle: 0 });
  if (element.type === "text") {
    const item = element.value;
    return {
      x: item.canvasX,
      y: item.canvasY,
      width: item.width * item.transformScale,
      height: item.height * item.transformScale,
    };
  }
  const radius = Math.max(12, element.value.style.size / 2);
  return {
    x: element.value.canvasX - radius,
    y: element.value.canvasY - radius,
    width: radius * 2,
    height: radius * 2,
  };
}

function rotateAround(point: ScenePoint, center: ScenePoint, angle: number): ScenePoint {
  const cosine = Math.cos(angle); const sine = Math.sin(angle);
  return {
    x: center.x + (point.x - center.x) * cosine - (point.y - center.y) * sine,
    y: center.y + (point.x - center.x) * sine + (point.y - center.y) * cosine,
  };
}

export function sceneBounds(element: SceneElement): SceneBounds {
  if (element.type === "raster") return annotationBounds(element.value);
  const bounds = unrotatedSceneBounds(element);
  const angle = element.value.angle ?? 0;
  if (!angle) return bounds;
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const corners = [
    { x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height },
  ].map((point) => rotateAround(point, center, angle));
  const xs = corners.map((point) => point.x); const ys = corners.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

export function elementsInsideSelection(
  elements: SceneElement[],
  bounds: SceneBounds,
): Set<string> {
  return new Set(elements.filter((element) => {
    const item = sceneBounds(element);
    return item.x >= bounds.x && item.y >= bounds.y
      && item.x + item.width <= bounds.x + bounds.width
      && item.y + item.height <= bounds.y + bounds.height;
  }).map((element) => element.id));
}

export function selectionBounds(elements: SceneElement[], selectedIds: ReadonlySet<string>): SceneBounds | null {
  const selected = elements.filter((element) => selectedIds.has(element.id));
  if (!selected.length) return null;
  const bounds = selected.map(sceneBounds);
  const x = Math.min(...bounds.map((item) => item.x));
  const y = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x, y, width: right - x, height: bottom - y };
}

export function elementGroupId(element: SceneElement): string | null {
  return element.value.groupId ?? null;
}

export function expandGroupSelection(elements: SceneElement[], ids: ReadonlySet<string>): Set<string> {
  const groups = new Set(
    elements
      .filter((element) => ids.has(element.id))
      .map(elementGroupId)
      .filter((value): value is string => Boolean(value)),
  );
  return new Set(
    elements
      .filter((element) => ids.has(element.id) || (elementGroupId(element) && groups.has(elementGroupId(element)!)))
      .map((element) => element.id),
  );
}

function withMetadata(element: SceneElement, changes: { groupId?: string | null; angle?: number }): SceneElement {
  return sceneElement({
    ...element.value,
    ...changes,
    version: (element.value.version ?? 0) + 1,
  } as RasterAnnotation | TextObject | NumberObject);
}

export function groupElements(elements: SceneElement[], selectedIds: ReadonlySet<string>, groupId: string): SceneElement[] {
  return elements.map((element) => selectedIds.has(element.id) ? withMetadata(element, { groupId }) : element);
}

export function ungroupElements(elements: SceneElement[], selectedIds: ReadonlySet<string>): SceneElement[] {
  const selectedGroups = new Set(
    elements
      .filter((element) => selectedIds.has(element.id))
      .map(elementGroupId)
      .filter((value): value is string => Boolean(value)),
  );
  return elements.map((element) => selectedGroups.has(elementGroupId(element) ?? "") ? withMetadata(element, { groupId: null }) : element);
}

export type LayerMove = "front" | "forward" | "backward" | "back";

export function moveSceneLayer(elements: SceneElement[], selectedIds: ReadonlySet<string>, move: LayerMove): SceneElement[] {
  const selected = elements.filter((element) => selectedIds.has(element.id));
  if (!selected.length) return elements;
  if (move === "front") return [...elements.filter((element) => !selectedIds.has(element.id)), ...selected];
  if (move === "back") return [...selected, ...elements.filter((element) => !selectedIds.has(element.id))];
  const next = [...elements];
  if (move === "forward") {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      if (selectedIds.has(next[index].id) && !selectedIds.has(next[index + 1].id)) {
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
      }
    }
  } else {
    for (let index = 1; index < next.length; index += 1) {
      if (selectedIds.has(next[index].id) && !selectedIds.has(next[index - 1].id)) {
        [next[index], next[index - 1]] = [next[index - 1], next[index]];
      }
    }
  }
  return next;
}

export function translateSceneElement(element: SceneElement, dx: number, dy: number): SceneElement {
  if (element.type === "raster") {
    return sceneElement({
      ...element.value,
      points: element.value.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })),
      version: (element.value.version ?? 0) + 1,
    });
  }
  return sceneElement({
    ...element.value,
    canvasX: element.value.canvasX + dx,
    canvasY: element.value.canvasY + dy,
    version: (element.value.version ?? 0) + 1,
  });
}

export function rotateSceneElement(element: SceneElement, angleDelta: number): SceneElement {
  return withMetadata(element, { angle: (element.value.angle ?? 0) + angleDelta });
}

export function sceneElementContains(element: SceneElement, point: ScenePoint): boolean {
  if (element.type === "raster") return hitTestAnnotation(element.value, point, 6);
  const bounds = unrotatedSceneBounds(element);
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const local = rotateAround(point, center, -(element.value.angle ?? 0));
  return local.x >= bounds.x && local.x <= bounds.x + bounds.width && local.y >= bounds.y && local.y <= bounds.y + bounds.height;
}

function mapPointBetweenBounds(point: ScenePoint, from: SceneBounds, to: SceneBounds): ScenePoint {
  return {
    x: to.x + ((point.x - from.x) / Math.max(0.001, from.width)) * to.width,
    y: to.y + ((point.y - from.y) / Math.max(0.001, from.height)) * to.height,
  };
}

export function resizeSceneSelection(
  elements: SceneElement[],
  selectedIds: ReadonlySet<string>,
  from: SceneBounds,
  to: SceneBounds,
): SceneElement[] {
  const sx = to.width / Math.max(0.001, from.width);
  const sy = to.height / Math.max(0.001, from.height);
  const strokeScale = Math.sqrt(Math.abs(sx * sy));
  return elements.map((element) => {
    if (!selectedIds.has(element.id)) return element;
    if (element.type === "raster") return sceneElement({
      ...element.value,
      points: element.value.points.map((point) => ({ ...point, ...mapPointBetweenBounds(point, from, to) })),
      style: { ...element.value.style, strokeWidth: element.value.style.strokeWidth * strokeScale },
      version: (element.value.version ?? 0) + 1,
    });
    const point = mapPointBetweenBounds(
      { x: element.value.canvasX, y: element.value.canvasY }, from, to,
    );
    if (element.type === "text") return sceneElement({
      ...element.value,
      canvasX: point.x,
      canvasY: point.y,
      transformScale: element.value.transformScale * strokeScale,
      version: (element.value.version ?? 0) + 1,
    });
    return sceneElement({
      ...element.value,
      canvasX: point.x,
      canvasY: point.y,
      style: { ...element.value.style, size: element.value.style.size * strokeScale },
      version: (element.value.version ?? 0) + 1,
    });
  });
}

export function rotateSceneSelection(
  elements: SceneElement[],
  selectedIds: ReadonlySet<string>,
  center: ScenePoint,
  delta: number,
): SceneElement[] {
  const cosine = Math.cos(delta);
  const sine = Math.sin(delta);
  const rotate = (point: ScenePoint): ScenePoint => ({
    x: center.x + (point.x - center.x) * cosine - (point.y - center.y) * sine,
    y: center.y + (point.x - center.x) * sine + (point.y - center.y) * cosine,
  });
  return elements.map((element) => {
    if (!selectedIds.has(element.id)) return element;
    if (element.type === "raster") {
      if (element.value.kind === "line" || element.value.kind === "arrow" || element.value.kind === "pen" || element.value.kind === "highlight") {
        return sceneElement({
          ...element.value,
          points: element.value.points.map((point) => ({ ...point, ...rotate(point) })),
          version: (element.value.version ?? 0) + 1,
        });
      }
      const bounds = annotationBounds(element.value);
      const ownCenter = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      const movedCenter = rotate(ownCenter);
      return sceneElement({
        ...element.value,
        points: element.value.points.map((point) => ({
          ...point,
          x: point.x + movedCenter.x - ownCenter.x,
          y: point.y + movedCenter.y - ownCenter.y,
        })),
        angle: (element.value.angle ?? 0) + delta,
        version: (element.value.version ?? 0) + 1,
      });
    }
    const point = rotate({ x: element.value.canvasX, y: element.value.canvasY });
    return sceneElement({
      ...element.value,
      canvasX: point.x,
      canvasY: point.y,
      angle: (element.value.angle ?? 0) + delta,
      version: (element.value.version ?? 0) + 1,
    });
  });
}

const BINDABLE_RASTER = new Set(["rect", "ellipse", "diamond"]);
export function bindingAtPoint(
  elements: SceneElement[],
  point: ScenePoint,
  excludeId: string,
  tolerance = 12,
) {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];
    if (element.id === excludeId || (element.type === "raster" && !BINDABLE_RASTER.has(element.value.kind))) continue;
    const hitBounds = sceneBounds(element);
    if (point.x < hitBounds.x - tolerance || point.x > hitBounds.x + hitBounds.width + tolerance
      || point.y < hitBounds.y - tolerance || point.y > hitBounds.y + hitBounds.height + tolerance) continue;
    const bounds = unrotatedSceneBounds(element);
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const local = rotateAround(point, center, -(element.value.angle ?? 0));
    return {
      elementId: element.id,
      anchor: {
        x: Math.max(0, Math.min(1, (local.x - bounds.x) / Math.max(1, bounds.width))),
        y: Math.max(0, Math.min(1, (local.y - bounds.y) / Math.max(1, bounds.height))),
      },
    };
  }
  return null;
}

export function resolveSceneBindings(elements: SceneElement[]): SceneElement[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  return elements.map((element) => {
    if (element.type === "text" && element.value.containerId) {
      const target = byId.get(element.value.containerId);
      if (!target) return sceneElement({ ...element.value, containerId: null });
      const targetBounds = sceneBounds(target);
      return sceneElement({
        ...element.value,
        canvasX: targetBounds.x + (targetBounds.width - element.value.width * element.value.transformScale) / 2,
        canvasY: targetBounds.y + (targetBounds.height - element.value.height * element.value.transformScale) / 2,
        angle: target.value.angle ?? 0,
      });
    }
    if (element.type !== "raster" || (element.value.kind !== "arrow" && element.value.kind !== "line")) return element;
    const points = element.value.points.map((point) => ({ ...point }));
    const apply = (binding: RasterAnnotation["startBinding"], index: number) => {
      if (!binding) return;
      const target = byId.get(binding.elementId);
      if (!target) return;
      const bounds = unrotatedSceneBounds(target);
      const local = {
        ...points[index],
        x: bounds.x + bounds.width * binding.anchor.x,
        y: bounds.y + bounds.height * binding.anchor.y,
      };
      const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      points[index] = { ...points[index], ...rotateAround(local, center, target.value.angle ?? 0) };
    };
    apply(element.value.startBinding, 0);
    apply(element.value.endBinding, points.length - 1);
    return sceneElement({ ...element.value, points });
  });
}

export interface SnapGuide { axis: "x" | "y"; value: number }
export function snapDelta(
  moving: SceneBounds,
  stationary: SceneElement[],
  canvas: { width: number; height: number },
  tolerance: number,
): { dx: number; dy: number; guides: SnapGuide[] } {
  const xTargets = [0, canvas.width / 2, canvas.width, ...stationary.flatMap((item) => {
    const b = sceneBounds(item); return [b.x, b.x + b.width / 2, b.x + b.width];
  })];
  const yTargets = [0, canvas.height / 2, canvas.height, ...stationary.flatMap((item) => {
    const b = sceneBounds(item); return [b.y, b.y + b.height / 2, b.y + b.height];
  })];
  const movingX = [moving.x, moving.x + moving.width / 2, moving.x + moving.width];
  const movingY = [moving.y, moving.y + moving.height / 2, moving.y + moving.height];
  const nearest = (movingValues: number[], targets: number[]) => {
    let best = { delta: 0, target: 0, distance: tolerance + 1 };
    for (const value of movingValues) for (const target of targets) {
      const distance = Math.abs(target - value);
      if (distance < best.distance) best = { delta: target - value, target, distance };
    }
    return best.distance <= tolerance ? best : null;
  };
  const x = nearest(movingX, xTargets); const y = nearest(movingY, yTargets);
  return { dx: x?.delta ?? 0, dy: y?.delta ?? 0, guides: [
    ...(x ? [{ axis: "x" as const, value: x.target }] : []),
    ...(y ? [{ axis: "y" as const, value: y.target }] : []),
  ] };
}

export function duplicateSceneSelection(
  elements: SceneElement[],
  selectedIds: ReadonlySet<string>,
  createId: (sourceId: string) => string,
  offset = 16,
): { elements: SceneElement[]; selectedIds: Set<string> } {
  const chosen = elements.filter((element) => selectedIds.has(element.id));
  const idMap = new Map(chosen.map((element) => [element.id, createId(element.id)]));
  const groupMap = new Map<string, string>();
  const duplicated = chosen.map((element) => {
    const copy = translateSceneElement(element, offset, offset);
    const sourceGroup = elementGroupId(element);
    if (sourceGroup && !groupMap.has(sourceGroup)) groupMap.set(sourceGroup, createId(sourceGroup));
    const value = {
      ...copy.value,
      id: idMap.get(element.id)!,
      groupId: sourceGroup ? groupMap.get(sourceGroup)! : null,
      seed: Math.abs(createId(element.id).split("").reduce((seed, character) => ((seed * 33) ^ character.charCodeAt(0)) | 0, 19)),
    } as RasterAnnotation | TextObject | NumberObject;
    if (copy.type === "raster") {
      const raster = value as RasterAnnotation;
      raster.startBinding = raster.startBinding && idMap.has(raster.startBinding.elementId)
        ? { ...raster.startBinding, elementId: idMap.get(raster.startBinding.elementId)! }
        : null;
      raster.endBinding = raster.endBinding && idMap.has(raster.endBinding.elementId)
        ? { ...raster.endBinding, elementId: idMap.get(raster.endBinding.elementId)! }
        : null;
    }
    if (copy.type === "text") {
      const text = value as TextObject;
      text.containerId = text.containerId && idMap.has(text.containerId)
        ? idMap.get(text.containerId)! : null;
    }
    return sceneElement(value);
  });
  return { elements: [...elements, ...duplicated], selectedIds: new Set(duplicated.map((item) => item.id)) };
}

export function deleteSceneSelection(
  elements: SceneElement[],
  selectedIds: ReadonlySet<string>,
): SceneElement[] {
  const removed = new Set(selectedIds);
  elements.forEach((element) => {
    if (element.type === "text" && element.value.containerId && selectedIds.has(element.value.containerId)) {
      removed.add(element.id);
    }
  });
  return elements
    .filter((element) => !removed.has(element.id))
    .map((element) => {
      if (element.type !== "raster") return element;
      const startBinding = element.value.startBinding && selectedIds.has(element.value.startBinding.elementId)
        ? null : element.value.startBinding;
      const endBinding = element.value.endBinding && selectedIds.has(element.value.endBinding.elementId)
        ? null : element.value.endBinding;
      if (startBinding === element.value.startBinding && endBinding === element.value.endBinding) return element;
      return sceneElement({ ...element.value, startBinding, endBinding, version: (element.value.version ?? 0) + 1 });
    });
}
