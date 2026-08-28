import { describe, expect, it } from "vitest";
import { editorSceneReducer, type EditorSceneState } from "./useEditorSceneState";

const initial: EditorSceneState = {
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

describe("editor scene reducer", () => {
  it("keeps related annotation mutations in one state transition", () => {
    const next = editorSceneReducer(initial, {
      type: "textObjects",
      value: (previous) => [...previous, { id: "text-1" } as never],
    });
    expect(next.textObjects).toHaveLength(1);
    expect(next.rasterAnnotations).toEqual([]);
  });

  it("resets transient selections and scene data together", () => {
    const withSelection = {
      ...initial,
      selectedRasterId: "annotation-1",
      textDraft: "draft",
      rasterAnnotations: [{ id: "annotation-1" } as never],
    };
    expect(editorSceneReducer(withSelection, { type: "reset" })).toEqual(initial);
  });
});
