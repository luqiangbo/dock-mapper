import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { DEFAULT_NUMBER_STYLE } from "./annotationTypes";
import { addNumberBadge, applyNumberBadgeStyle, isNumberBadgeBody } from "./numberBadge";
import { numberGroupsToErase } from "./specialToolState";
vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { IMMEDIATELY: "immediately", EVENTUALLY: "eventually" },
  convertToExcalidrawElements: (parts: Record<string, unknown>[]) =>
    parts.map((part) => ({
      width: 12,
      height: 20,
      angle: 0,
      isDeleted: false,
      version: 1,
      ...part,
    })),
  newElementWith: (element: Record<string, unknown>, patch: Record<string, unknown>) => ({
    ...element,
    ...patch,
    version: Number(element.version) + 1,
  }),
}));
type Element = ReturnType<ExcalidrawImperativeAPI["getSceneElementsIncludingDeleted"]>[number];
const base = { width: 600, height: 400 } as HTMLCanvasElement;
function editor() {
  let elements: readonly Element[] = [];
  const state = { zoom: { value: 1 }, selectedElementIds: {} as Record<string, true> };
  const updateScene = vi.fn(
    (update: {
      elements: readonly Element[];
      appState?: { selectedElementIds: Record<string, true> };
    }) => {
      elements = update.elements;
      if (update.appState) state.selectedElementIds = update.appState.selectedElementIds;
    },
  );
  const api = {
    getSceneElements: () => elements.filter((element) => !element.isDeleted),
    getSceneElementsIncludingDeleted: () => elements,
    getAppState: () => state,
    updateScene,
  } as unknown as ExcalidrawImperativeAPI;
  return { api, state, updateScene };
}
beforeEach(() =>
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({
        measureText: () => ({
          width: 12,
          actualBoundingBoxAscent: 15,
          actualBoundingBoxDescent: 0,
        }),
      }),
    }),
  }),
);
afterEach(() => vi.unstubAllGlobals());
describe("原生序号对象的编辑和输出结构", () => {
  it("非零选区原点只叠加一次，连续点击递增且不生成箭头", () => {
    const { api } = editor();
    expect(
      addNumberBadge(
        api,
        base,
        { x: 100, y: 50 },
        DEFAULT_NUMBER_STYLE,
        undefined,
        { x: 300, y: 200 },
        0.5,
      ),
    ).toBe(1);
    expect(addNumberBadge(api, base, { x: 200, y: 50 }, DEFAULT_NUMBER_STYLE)).toBe(2);
    const body = api.getSceneElements().find(isNumberBadgeBody)!;
    expect(body.x + body.width / 2).toBe(400);
    expect(body.y + body.height / 2).toBe(250);
    expect(api.getSceneElements().some((element) => element.type === "arrow")).toBe(false);
    expect(api.getSceneElements().filter(isNumberBadgeBody)).toHaveLength(2);
  });
  it("改变颜色与尺寸保持编号和点击中心，并可作为整组编辑", () => {
    const { api, state } = editor();
    addNumberBadge(api, base, { x: 100, y: 80 }, DEFAULT_NUMBER_STYLE, 7);
    const body = api.getSceneElements().find(isNumberBadgeBody)!;
    for (const element of api.getSceneElements()) state.selectedElementIds[element.id] = true;
    applyNumberBadgeStyle(
      api,
      base,
      { ...DEFAULT_NUMBER_STYLE, backgroundColor: "#1971c2", size: 40 },
      true,
    );
    const updated = api.getSceneElements().find(isNumberBadgeBody)!;
    expect(updated).toMatchObject({
      id: body.id,
      backgroundColor: "#1971c2",
      customData: { dockmapperNumber: 7 },
    });
    expect(updated.x + updated.width / 2).toBe(100);
    expect(updated.y + updated.height / 2).toBe(80);
    expect(updated.version).toBeGreaterThan(body.version);
    expect(api.getSceneElements().map((element) => element.customData?.dockmapperRole)).toEqual([
      "badge",
      "text",
    ]);
  });
  it("旧样式多余部件淘汰后，橡皮擦不会误删有效序号", () => {
    const { api, state } = editor();
    addNumberBadge(api, base, { x: 100, y: 80 }, DEFAULT_NUMBER_STYLE);
    const all = api.getSceneElementsIncludingDeleted();
    const body = all.find(isNumberBadgeBody)!;
    api.updateScene({
      elements: [
        ...all,
        { ...body, id: "old-shadow", customData: { ...body.customData, dockmapperRole: "shadow" } },
      ],
    });
    for (const element of api.getSceneElements()) state.selectedElementIds[element.id] = true;
    applyNumberBadgeStyle(api, base, DEFAULT_NUMBER_STYLE, true);
    const updated = api.getSceneElementsIncludingDeleted();
    expect(updated.find((item) => item.id === "old-shadow")).toMatchObject({
      isDeleted: true,
      customData: { dockmapperRetired: true },
    });
    expect(state.selectedElementIds["old-shadow"]).toBeUndefined();
    expect(numberGroupsToErase(updated).size).toBe(0);
    expect(updated.filter(isNumberBadgeBody)).toHaveLength(1);
  });
});
