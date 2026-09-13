import { describe, expect, it } from "vitest";
import { editorSceneReducer, type EditorSceneState } from "./useEditorSceneState";

const initial: EditorSceneState = {
  tool: null,
  textEditor: null,
  textDraft: "",
  elements: [],
  rasterPreview: null,
  selectedIds: [],
  primarySelectedId: null,
};

describe("editor scene reducer", () => {
  it("keeps related annotation mutations in one state transition", () => {
    const next = editorSceneReducer(initial, {
      type: "elements",
      value: (previous) => [...previous, { type: "text", id: "text-1", value: { id: "text-1" } as never }],
    });
    expect(next.elements).toHaveLength(1);
  });

  it("resets transient selections and scene data together", () => {
    const withSelection: EditorSceneState = {
      ...initial,
      selectedIds: ["annotation-1"],
      primarySelectedId: "annotation-1",
      textDraft: "draft",
      elements: [{ type: "raster", id: "annotation-1", value: { id: "annotation-1" } as never }],
    };
    expect(editorSceneReducer(withSelection, { type: "reset" })).toEqual(initial);
  });
});
