import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { ObjectMutationTransaction, useEditorHistory } from "./useCanvasHistory";
import { cloneRasterAnnotations, type RasterAnnotation } from "../components/annotationScene";
import type { NumberObject } from "../components/numberObjects";
import type { TextObject } from "../components/textTypes";
import { cloneSceneElements, type SceneElement } from "../components/whiteboardScene";

interface ObjectSnapshot {
  elements: SceneElement[];
}

interface LiveObjectState {
  rasterAnnotations: RasterAnnotation[];
  textObjects: TextObject[];
  numberObjects: NumberObject[];
  elements: SceneElement[];
}

interface GestureWithBaseline {
  baseline: RasterAnnotation[];
}

interface ObjectHistoryControllerOptions {
  rasterAnnotations: RasterAnnotation[];
  textObjects: TextObject[];
  numberObjects: NumberObject[];
  sceneElements: SceneElement[];
  setRasterAnnotations: Dispatch<SetStateAction<RasterAnnotation[]>>;
  setTextObjects: Dispatch<SetStateAction<TextObject[]>>;
  setNumberObjects: Dispatch<SetStateAction<NumberObject[]>>;
  setSceneElements: Dispatch<SetStateAction<SceneElement[]>>;
  clearRasterPreview: () => void;
  clearTransientSelection: () => void;
  gestureRef: MutableRefObject<GestureWithBaseline | null>;
  resetNativeInput: () => void;
}

function cloneSnapshot(snapshot: ObjectSnapshot): ObjectSnapshot {
  return { elements: cloneSceneElements(snapshot.elements) };
}

/** Owns object snapshots, mutation transactions and undo/redo cleanup. */
export function useObjectHistoryController(options: ObjectHistoryControllerOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const stateRef = useRef<LiveObjectState>({
    rasterAnnotations: [],
    textObjects: [],
    numberObjects: [],
    elements: [],
  });
  stateRef.current = {
    rasterAnnotations: options.rasterAnnotations,
    textObjects: options.textObjects,
    numberObjects: options.numberObjects,
    elements: options.sceneElements,
  };
  const mutationRef = useRef(new ObjectMutationTransaction<ObjectSnapshot>());
  const styleChangedRef = useRef(false);

  const restoreSnapshot = useCallback((snapshot: ObjectSnapshot) => {
    const restored = cloneSnapshot(snapshot);
    const current = optionsRef.current;
    current.setSceneElements(restored.elements);
    current.clearRasterPreview();
  }, []);
  const history = useEditorHistory(restoreSnapshot);
  const captureSnapshot = useCallback(() => cloneSnapshot({ elements: stateRef.current.elements }), []);
  const beginMutation = useCallback(() => {
    mutationRef.current.begin(captureSnapshot());
  }, [captureSnapshot]);
  const commitMutation = useCallback(
    (changed: boolean) => {
      const snapshot = mutationRef.current.commit(changed);
      if (snapshot) history.pushObjects(snapshot);
    },
    [history.pushObjects],
  );
  const cancelMutation = useCallback(() => mutationRef.current.cancel(), []);
  const pushCurrent = useCallback(
    () => history.pushObjects(captureSnapshot()),
    [captureSnapshot, history.pushObjects],
  );
  const clearTransientState = useCallback(() => {
    const current = optionsRef.current;
    current.clearRasterPreview();
    current.resetNativeInput();
    current.clearTransientSelection();
  }, []);
  const undo = useCallback(() => {
    cancelMutation();
    const current = optionsRef.current;
    const gesture = current.gestureRef.current;
    if (gesture) current.setRasterAnnotations(cloneRasterAnnotations(gesture.baseline));
    current.gestureRef.current = null;
    clearTransientState();
    history.undo(captureSnapshot());
  }, [cancelMutation, captureSnapshot, clearTransientState, history.undo]);
  const redo = useCallback(() => {
    cancelMutation();
    optionsRef.current.gestureRef.current = null;
    clearTransientState();
    history.redo(captureSnapshot());
  }, [cancelMutation, captureSnapshot, clearTransientState, history.redo]);

  return {
    stateRef,
    mutationRef,
    styleChangedRef,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    resetHistory: history.reset,
    captureSnapshot,
    beginMutation,
    commitMutation,
    cancelMutation,
    pushCurrent,
    undo,
    redo,
  };
}
