import { useCallback, useMemo, useReducer } from "react";
import type { AnnotTool } from "../components/AnnotationToolbar";
import type { RasterAnnotation } from "../components/annotationScene";
import type { NumberObject } from "../components/numberObjects";
import type { TextEditorState, TextObject } from "../components/textTypes";
import {
  replaceSceneType,
  type SceneElement,
  type SceneValue,
} from "../components/whiteboardScene";

type StateUpdate<T> = T | ((previous: T) => T);

export interface EditorSceneState {
  tool: AnnotTool;
  textEditor: TextEditorState | null;
  textDraft: string;
  elements: SceneElement[];
  rasterPreview: RasterAnnotation | null;
  selectedIds: string[];
  primarySelectedId: string | null;
}

const INITIAL: EditorSceneState = {
  tool: null,
  textEditor: null,
  textDraft: "",
  elements: [],
  rasterPreview: null,
  selectedIds: [],
  primarySelectedId: null,
};

type SceneType = SceneElement["type"];
type EditorSceneAction =
  | { type: "reset" }
  | { type: "tool"; value: StateUpdate<AnnotTool> }
  | { type: "textEditor"; value: StateUpdate<TextEditorState | null> }
  | { type: "textDraft"; value: StateUpdate<string> }
  | { type: "elements"; value: StateUpdate<SceneElement[]> }
  | { type: "rasterPreview"; value: StateUpdate<RasterAnnotation | null> }
  | { type: "replaceRaster"; value: StateUpdate<RasterAnnotation[]> }
  | { type: "replaceText"; value: StateUpdate<TextObject[]> }
  | { type: "replaceNumber"; value: StateUpdate<NumberObject[]> }
  | { type: "selectIds"; value: StateUpdate<string[]>; primary?: string | null }
  | { type: "selectType"; sceneType: SceneType; value: StateUpdate<string | null> };

function resolve<T>(previous: T, update: StateUpdate<T>): T {
  return typeof update === "function" ? (update as (value: T) => T)(previous) : update;
}

function valuesOf(state: EditorSceneState, type: SceneType): SceneValue[] {
  return state.elements
    .filter((element) => element.type === type)
    .map((element) => element.value);
}

function replaceValues(
  state: EditorSceneState,
  type: SceneType,
  update: StateUpdate<SceneValue[]>,
): EditorSceneState {
  const current = valuesOf(state, type);
  const values = resolve(current, update);
  const elements = replaceSceneType(state.elements, type, values);
  const liveIds = new Set(elements.map((element) => element.id));
  const selectedIds = state.selectedIds.filter((id) => liveIds.has(id));
  return {
    ...state,
    elements,
    selectedIds,
    primarySelectedId: state.primarySelectedId && liveIds.has(state.primarySelectedId)
      ? state.primarySelectedId
      : selectedIds[selectedIds.length - 1] ?? null,
  };
}

export function editorSceneReducer(state: EditorSceneState, action: EditorSceneAction): EditorSceneState {
  if (action.type === "reset") return INITIAL;
  switch (action.type) {
    case "tool": return { ...state, tool: resolve(state.tool, action.value) };
    case "textEditor": return { ...state, textEditor: resolve(state.textEditor, action.value) };
    case "textDraft": return { ...state, textDraft: resolve(state.textDraft, action.value) };
    case "rasterPreview": return { ...state, rasterPreview: resolve(state.rasterPreview, action.value) };
    case "elements": {
      const elements = resolve(state.elements, action.value);
      const liveIds = new Set(elements.map((element) => element.id));
      const selectedIds = state.selectedIds.filter((id) => liveIds.has(id));
      return { ...state, elements, selectedIds, primarySelectedId: selectedIds.includes(state.primarySelectedId ?? "") ? state.primarySelectedId : selectedIds[selectedIds.length - 1] ?? null };
    }
    case "replaceRaster": return replaceValues(state, "raster", action.value as StateUpdate<SceneValue[]>);
    case "replaceText": return replaceValues(state, "text", action.value as StateUpdate<SceneValue[]>);
    case "replaceNumber": return replaceValues(state, "number", action.value as StateUpdate<SceneValue[]>);
    case "selectIds": {
      const selectedIds = [...new Set(resolve(state.selectedIds, action.value))];
      return { ...state, selectedIds, primarySelectedId: action.primary === undefined ? selectedIds[selectedIds.length - 1] ?? null : action.primary };
    }
    case "selectType": {
      const current = state.primarySelectedId && state.elements.some((element) => element.id === state.primarySelectedId && element.type === action.sceneType)
        ? state.primarySelectedId
        : null;
      const value = resolve(current, action.value);
      if (value) return { ...state, selectedIds: [value], primarySelectedId: value };
      const idsOfType = new Set(state.elements.filter((element) => element.type === action.sceneType).map((element) => element.id));
      const selectedIds = state.selectedIds.filter((id) => !idsOfType.has(id));
      return { ...state, selectedIds, primarySelectedId: selectedIds[selectedIds.length - 1] ?? null };
    }
  }
}

export function useEditorSceneState() {
  const [state, dispatch] = useReducer(editorSceneReducer, INITIAL);
  const rasterAnnotations = valuesOf(state, "raster") as RasterAnnotation[];
  const textObjects = valuesOf(state, "text") as TextObject[];
  const numberObjects = valuesOf(state, "number") as NumberObject[];
  const primary = state.elements.find((element) => element.id === state.primarySelectedId);
  const setTool = useCallback((value: StateUpdate<AnnotTool>) => dispatch({ type: "tool", value }), []);
  const setTextEditor = useCallback((value: StateUpdate<TextEditorState | null>) => dispatch({ type: "textEditor", value }), []);
  const setTextDraft = useCallback((value: StateUpdate<string>) => dispatch({ type: "textDraft", value }), []);
  const setRasterAnnotations = useCallback((value: StateUpdate<RasterAnnotation[]>) => dispatch({ type: "replaceRaster", value }), []);
  const setTextObjects = useCallback((value: StateUpdate<TextObject[]>) => dispatch({ type: "replaceText", value }), []);
  const setNumberObjects = useCallback((value: StateUpdate<NumberObject[]>) => dispatch({ type: "replaceNumber", value }), []);
  const setRasterPreview = useCallback((value: StateUpdate<RasterAnnotation | null>) => dispatch({ type: "rasterPreview", value }), []);
  const setSceneElements = useCallback((value: StateUpdate<SceneElement[]>) => dispatch({ type: "elements", value }), []);
  const setSelectedIds = useCallback((value: StateUpdate<string[]>, primary?: string | null) => dispatch({ type: "selectIds", value, primary }), []);
  const selectType = useCallback((sceneType: SceneType, value: StateUpdate<string | null>) => dispatch({ type: "selectType", sceneType, value }), []);
  const resetScene = useCallback(() => dispatch({ type: "reset" }), []);
  const setSelectedRasterId = useCallback(
    (value: StateUpdate<string | null>) => selectType("raster", value),
    [selectType],
  );
  const setSelectedTextId = useCallback(
    (value: StateUpdate<string | null>) => selectType("text", value),
    [selectType],
  );
  const setSelectedNumberId = useCallback(
    (value: StateUpdate<string | null>) => selectType("number", value),
    [selectType],
  );
  return useMemo(() => ({
    tool: state.tool,
    setTool,
    textEditor: state.textEditor,
    setTextEditor,
    textDraft: state.textDraft,
    setTextDraft,
    textObjects,
    setTextObjects,
    numberObjects,
    setNumberObjects,
    rasterAnnotations,
    setRasterAnnotations,
    rasterPreview: state.rasterPreview,
    setRasterPreview,
    sceneElements: state.elements,
    setSceneElements,
    selectedIds: state.selectedIds,
    setSelectedIds,
    selectedRasterId: primary?.type === "raster" ? primary.id : null,
    setSelectedRasterId,
    selectedTextId: primary?.type === "text" ? primary.id : null,
    setSelectedTextId,
    selectedNumberId: primary?.type === "number" ? primary.id : null,
    setSelectedNumberId,
    resetScene,
  }), [state, rasterAnnotations, textObjects, numberObjects, setTool, setTextEditor, setTextDraft, setRasterAnnotations, setTextObjects, setNumberObjects, setRasterPreview, setSceneElements, setSelectedIds, setSelectedRasterId, setSelectedTextId, setSelectedNumberId, resetScene, primary]);
}
