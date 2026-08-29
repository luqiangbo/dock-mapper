import { useCallback, useReducer, useRef } from "react";

export interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CapturePhase = "idle" | "capturing" | "selecting" | "editing" | "committing";

export interface CaptureLifecycleState {
  phase: CapturePhase;
  busy: boolean;
  shotReady: boolean;
  error: string | null;
  selection: Selection | null;
}

export type CaptureLifecycleAction =
  | { type: "phase"; value: CapturePhase }
  | { type: "busy"; value: boolean }
  | { type: "shot-ready"; value: boolean }
  | { type: "error"; value: string | null }
  | { type: "selection"; value: Selection | null }
  | { type: "capture-started" }
  | { type: "capture-ready" }
  | { type: "editing-started" }
  | { type: "committing-started" }
  | { type: "editing-restored" }
  | { type: "failed"; message: string; phase: Extract<CapturePhase, "selecting" | "editing"> }
  | { type: "reset" };

export const INITIAL_CAPTURE_LIFECYCLE: CaptureLifecycleState = {
  phase: "idle",
  busy: false,
  shotReady: false,
  error: null,
  selection: null,
};

export function captureLifecycleReducer(
  state: CaptureLifecycleState,
  action: CaptureLifecycleAction,
): CaptureLifecycleState {
  switch (action.type) {
    case "phase":
      return { ...state, phase: action.value };
    case "busy":
      return { ...state, busy: action.value };
    case "shot-ready":
      return { ...state, shotReady: action.value };
    case "error":
      return { ...state, error: action.value };
    case "selection":
      return { ...state, selection: action.value };
    case "capture-started":
      return { ...state, phase: "capturing", busy: false, shotReady: false, error: null };
    case "capture-ready":
      return { ...state, phase: "selecting", busy: false, shotReady: false, error: null };
    case "editing-started":
      return { ...state, phase: "editing", busy: false, shotReady: false, error: null };
    case "committing-started":
      return { ...state, phase: "committing", busy: true, error: null };
    case "editing-restored":
      return { ...state, phase: "editing", busy: false };
    case "failed":
      return { ...state, phase: action.phase, busy: false, error: action.message };
    case "reset":
      return INITIAL_CAPTURE_LIFECYCLE;
  }
}

export function useCaptureLifecycle() {
  const [state, dispatch] = useReducer(captureLifecycleReducer, INITIAL_CAPTURE_LIFECYCLE);
  const selectionRef = useRef<Selection | null>(null);
  const setPhase = useCallback((value: CapturePhase) => dispatch({ type: "phase", value }), []);
  const setBusy = useCallback((value: boolean) => dispatch({ type: "busy", value }), []);
  const setShotReady = useCallback((value: boolean) => dispatch({ type: "shot-ready", value }), []);
  const setError = useCallback((value: string | null) => dispatch({ type: "error", value }), []);
  const setSelection = useCallback((value: Selection | null) => {
    selectionRef.current = value;
    dispatch({ type: "selection", value });
  }, []);
  const beginCapture = useCallback(() => dispatch({ type: "capture-started" }), []);
  const captureReady = useCallback(() => dispatch({ type: "capture-ready" }), []);
  const beginEditing = useCallback(() => dispatch({ type: "editing-started" }), []);
  const beginCommit = useCallback(() => dispatch({ type: "committing-started" }), []);
  const restoreEditing = useCallback(() => dispatch({ type: "editing-restored" }), []);
  const fail = useCallback(
    (message: string, phase: Extract<CapturePhase, "selecting" | "editing">) =>
      dispatch({ type: "failed", message, phase }),
    [],
  );
  const reset = useCallback(() => {
    selectionRef.current = null;
    dispatch({ type: "reset" });
  }, []);
  return {
    ...state,
    setPhase,
    setBusy,
    setShotReady,
    setError,
    setSelection,
    selectionRef,
    beginCapture,
    captureReady,
    beginEditing,
    beginCommit,
    restoreEditing,
    fail,
    reset,
  };
}
