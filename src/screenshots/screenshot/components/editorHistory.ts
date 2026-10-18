import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
export interface EditorHistoryState {
  canUndo: boolean;
  canRedo: boolean;
}
export const EMPTY_EDITOR_HISTORY: EditorHistoryState = { canUndo: false, canRedo: false };
export interface EditorHistoryBridge {
  getState(): EditorHistoryState;
  subscribe(callback: (state: EditorHistoryState) => void): () => void;
  undo(): void;
  redo(): void;
}
export function editorHistory(api: ExcalidrawImperativeAPI): EditorHistoryBridge {
  const history = api.history as typeof api.history & Partial<EditorHistoryBridge>;
  if (!history.getState || !history.subscribe || !history.undo || !history.redo)
    throw new Error("编辑器历史记录适配不可用，请重新启动开发服务或更新程序");
  return history as EditorHistoryBridge;
}
