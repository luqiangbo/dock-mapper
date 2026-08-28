import { useCallback, useMemo, useReducer } from "react";
import type { AnnotTool } from "../components/AnnotationToolbar";
import type { RasterAnnotation } from "../components/annotationScene";
import type { NumberObject } from "../components/numberObjects";
import type { TextEditorState, TextObject } from "../components/textTypes";

type StateUpdate<T> = T | ((previous: T) => T);

export interface EditorSceneState {
  tool: AnnotTool;
  textEditor: TextEditorState | null;
  textDraft: string;
  textObjects: TextObject[];
  numberObjects: NumberObject[];
  rasterAnnotations: RasterAnnotation[];
  rasterPreview: RasterAnnotation | null;
  selectedRasterId: string | null;
  selectedTextId: string | null;
  selectedNumberId: string | null;
}

const INITIAL: EditorSceneState = {
  tool: null,
  textEditor: null,
  textDraft: "",
  textObjects: [],
  numberObjects: [],
  rasterAnnotations: [],
  rasterPreview: null,
  selectedRasterId: null,
  selectedTextId: null,
  selectedNumberId: null,
};

type EditorSceneAction =
  | { type: "reset" }
  | { type: "tool"; value: StateUpdate<AnnotTool> }
  | { type: "textEditor"; value: StateUpdate<TextEditorState | null> }
  | { type: "textDraft"; value: StateUpdate<string> }
  | { type: "textObjects"; value: StateUpdate<TextObject[]> }
  | { type: "numberObjects"; value: StateUpdate<NumberObject[]> }
  | { type: "rasterAnnotations"; value: StateUpdate<RasterAnnotation[]> }
  | { type: "rasterPreview"; value: StateUpdate<RasterAnnotation | null> }
  | { type: "selectedRasterId"; value: StateUpdate<string | null> }
  | { type: "selectedTextId"; value: StateUpdate<string | null> }
  | { type: "selectedNumberId"; value: StateUpdate<string | null> };

function resolve<T>(previous: T, update: StateUpdate<T>): T {
  return typeof update === "function" ? (update as (value: T) => T)(previous) : update;
}

export function editorSceneReducer(
  state: EditorSceneState,
  action: EditorSceneAction,
): EditorSceneState {
  if (action.type === "reset") return INITIAL;
  switch (action.type) {
    case "tool":
      return { ...state, tool: resolve(state.tool, action.value) };
    case "textEditor":
      return { ...state, textEditor: resolve(state.textEditor, action.value) };
    case "textDraft":
      return { ...state, textDraft: resolve(state.textDraft, action.value) };
    case "textObjects":
      return { ...state, textObjects: resolve(state.textObjects, action.value) };
    case "numberObjects":
      return { ...state, numberObjects: resolve(state.numberObjects, action.value) };
    case "rasterAnnotations":
      return { ...state, rasterAnnotations: resolve(state.rasterAnnotations, action.value) };
    case "rasterPreview":
      return { ...state, rasterPreview: resolve(state.rasterPreview, action.value) };
    case "selectedRasterId":
      return { ...state, selectedRasterId: resolve(state.selectedRasterId, action.value) };
    case "selectedTextId":
      return { ...state, selectedTextId: resolve(state.selectedTextId, action.value) };
    case "selectedNumberId":
      return { ...state, selectedNumberId: resolve(state.selectedNumberId, action.value) };
  }
}

export function useEditorSceneState() {
  const [state, dispatch] = useReducer(editorSceneReducer, INITIAL);
  const setter = useCallback(
    <T,>(type: EditorSceneAction["type"]) =>
      (value: StateUpdate<T>) =>
        dispatch({ type, value } as EditorSceneAction),
    [],
  );
  const actions = useMemo(
    () => ({
      resetScene: () => dispatch({ type: "reset" }),
      setTool: setter<AnnotTool>("tool"),
      setTextEditor: setter<TextEditorState | null>("textEditor"),
      setTextDraft: setter<string>("textDraft"),
      setTextObjects: setter<TextObject[]>("textObjects"),
      setNumberObjects: setter<NumberObject[]>("numberObjects"),
      setRasterAnnotations: setter<RasterAnnotation[]>("rasterAnnotations"),
      setRasterPreview: setter<RasterAnnotation | null>("rasterPreview"),
      setSelectedRasterId: setter<string | null>("selectedRasterId"),
      setSelectedTextId: setter<string | null>("selectedTextId"),
      setSelectedNumberId: setter<string | null>("selectedNumberId"),
    }),
    [setter],
  );
  return { ...state, ...actions };
}
