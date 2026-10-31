import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  newElementWith,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { NumberStyle } from "./annotationTypes";
import font from "./numberFont.json";
import { numberBadgeGeometry } from "./numberBadgeGeometry";
import { numberBadgeDesign } from "./numberBadgeDesign";
import { measureNumberLabel } from "./numberBadgeFont";
import { formatSequence } from "./numberSequence";
import { nextNumber } from "./specialToolState";
export { loadNumberFont } from "./numberBadgeFont";

type Element = ReturnType<ExcalidrawImperativeAPI["getSceneElementsIncludingDeleted"]>[number];
export function isNumberBadgeBody(element: {
  type: string;
  customData?: Record<string, unknown> | null;
  isDeleted?: boolean;
}) {
  return (
    !element.isDeleted &&
    element.type !== "text" &&
    element.customData?.dockmapperTool === "number" &&
    element.customData?.dockmapperRole === "badge"
  );
}
const groupOf = (element: Element) =>
  String(element.customData?.dockmapperGroup ?? element.groupIds[0] ?? element.id);

export function numberStyleForBadge(
  body: Element,
  fallback: NumberStyle,
  zoom: number,
): NumberStyle {
  const saved = body.customData?.dockmapperStyle as NumberStyle | undefined;
  const initialDiameter = Number(body.customData?.dockmapperDiameter) || body.width;
  const initialZoom = Number(body.customData?.dockmapperZoom) || zoom;
  return {
    ...fallback,
    ...saved,
    start: Number(body.customData?.dockmapperNumber) || 1,
    appearance: "flat",
    palette: "custom",
    backgroundColor: saved?.backgroundColor ?? body.backgroundColor,
    format: (body.customData?.dockmapperFormat as NumberStyle["format"]) ?? fallback.format,
    size: Math.max(
      16,
      Math.round(
        saved
          ? (((saved.size * body.width) / initialDiameter) * zoom) / initialZoom
          : body.width * zoom,
      ),
    ),
  };
}

function buildBadge(
  base: HTMLCanvasElement,
  point: { x: number; y: number },
  style: NumberStyle,
  value: number,
  zoom: number,
  group: string = crypto.randomUUID(),
  previous: readonly Element[] = [],
) {
  const label = formatSequence(value, style.format),
    design = numberBadgeDesign(style, value);
  const geometry = numberBadgeGeometry(
    point,
    style.size,
    zoom,
    measureNumberLabel(label, style.size, zoom),
    base,
  );
  const { x, y, diameter: d } = geometry;
  const common = {
    groupIds: previous.find(isNumberBadgeBody)?.groupIds ?? [group],
    roughness: 0,
    opacity: previous.find(isNumberBadgeBody)?.opacity ?? 100,
  };
  const skeleton = (role: string, shape: Record<string, unknown>) => ({
    ...common,
    ...shape,
    id:
      previous.find(
        (item) =>
          item.customData?.dockmapperRole === role && (role !== "badge" || item.type !== "text"),
      )?.id ?? crypto.randomUUID(),
    customData: {
      dockmapperTool: "number",
      dockmapperNumber: value,
      dockmapperRole: role,
      dockmapperGroup: group,
      dockmapperFormat: style.format ?? "decimal",
      dockmapperStyle: { ...style },
      dockmapperDiameter: d,
      dockmapperZoom: zoom,
    },
  });
  const parts = [
    skeleton("badge", {
      ...common,
      type: "ellipse",
      x,
      y,
      width: d,
      height: d,
      fillStyle: "solid",
      backgroundColor: design.fill,
      strokeColor: "transparent",
      strokeWidth: 0,
    }),
    skeleton("text", {
      type: "text",
      x: geometry.textX,
      y: geometry.textY,
      text: label,
      originalText: label,
      fontFamily: font.id,
      fontSize: geometry.fontSize,
      strokeColor: design.text,
      textAlign: "left",
      verticalAlign: "top",
    }),
  ];
  const converted = convertToExcalidrawElements(parts as never);
  return converted.map((element) => {
    let next = element;
    if (element.type === "text") next = newElementWith(element, { x: point.x - element.width / 2 });
    const old = previous.find((item) => item.id === next.id);
    if (!old) return next;
    const { version: _version, versionNonce: _nonce, ...patch } = next;
    return newElementWith(old, patch as never);
  });
}

export function addNumberBadge(
  api: ExcalidrawImperativeAPI,
  base: HTMLCanvasElement,
  point: { x: number; y: number },
  style: NumberStyle,
  specifiedValue?: number,
  origin = { x: 0, y: 0 },
  zoom: number = api.getAppState().zoom.value,
) {
  const value = specifiedValue ?? Math.max(style.start ?? 1, nextNumber(api.getSceneElements()));
  const created = buildBadge(
    base,
    { x: point.x + origin.x, y: point.y + origin.y },
    style,
    value,
    Math.max(0.01, zoom),
  );
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...created],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return value;
}

export function replaceNumberBadges(
  elements: readonly Element[],
  bodies: readonly Element[],
  base: HTMLCanvasElement,
  zoom: number,
  style: (body: Element, index: number) => NumberStyle,
  value: (body: Element, index: number) => number,
) {
  const groups = new Map<string, Element[]>();
  for (const [index, body] of bodies.entries()) {
    const group = groupOf(body),
      members = elements.filter(
        (item) => item.customData?.dockmapperTool === "number" && groupOf(item) === group,
      );
    const center = { x: body.x + body.width / 2, y: body.y + body.height / 2 };
    const fresh = buildBadge(
      base,
      center,
      style(body, index),
      value(body, index),
      zoom,
      group,
      members,
    );
    const angle = body.angle;
    const rotated = angle
      ? fresh.map((item) => {
          const dx = item.x + item.width / 2 - center.x,
            dy = item.y + item.height / 2 - center.y;
          return newElementWith(item, {
            x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle) - item.width / 2,
            y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) - item.height / 2,
            angle,
          });
        })
      : fresh;
    const ids = new Set(rotated.map((item) => item.id));
    const retired = members
      .filter((member) => !ids.has(member.id))
      .map((member) =>
        member.customData?.dockmapperRole === "comment"
          ? member
          : newElementWith(member, {
              isDeleted: true,
              customData: { ...member.customData, dockmapperRetired: true },
            }),
      );
    // Keep each badge body and label adjacent, including when retiring legacy parts.
    groups.set(group, [...rotated, ...retired]);
  }
  const emitted = new Set<string>();
  return elements.flatMap((item) => {
    const group = groupOf(item);
    const replacement =
      item.customData?.dockmapperTool === "number" ? groups.get(group) : undefined;
    if (!replacement) return [item];
    if (emitted.has(group)) return [];
    emitted.add(group);
    return replacement;
  });
}

export function applyNumberBadgeStyle(
  api: ExcalidrawImperativeAPI,
  base: HTMLCanvasElement,
  style: NumberStyle,
  commit: boolean,
) {
  const all = api.getSceneElementsIncludingDeleted(),
    selected = api.getAppState().selectedElementIds;
  const selectedGroups = new Set(
    all
      .filter((item) => selected[item.id] && item.customData?.dockmapperTool === "number")
      .map(groupOf),
  );
  const bodies = all.filter((item) => isNumberBadgeBody(item) && selectedGroups.has(groupOf(item)));
  if (!bodies.length) return;
  const elements = replaceNumberBadges(
    all,
    bodies,
    base,
    api.getAppState().zoom.value,
    () => style,
    (body) => Number(body.customData?.dockmapperNumber) || 1,
  );
  const selectedElementIds = { ...selected };
  for (const element of elements)
    if (element.customData?.dockmapperTool === "number" && selectedGroups.has(groupOf(element))) {
      if (element.isDeleted) delete selectedElementIds[element.id];
      else selectedElementIds[element.id] = true;
    }
  api.updateScene({
    elements,
    appState: { selectedElementIds },
    captureUpdate: commit ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.EVENTUALLY,
  });
}
