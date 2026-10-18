export interface CaptureStartState {
  generation: number;
  phase: "starting" | "shown" | "failed";
  error: string | null;
}
export interface CaptureStartupSnapshot {
  requesting: boolean;
  state: CaptureStartState | null;
}
export function createCaptureStartup() {
  let snapshot: CaptureStartupSnapshot = { requesting: false, state: null };
  const listeners = new Set<() => void>();
  const publish = (next: CaptureStartupSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const receive = (state: CaptureStartState) => {
    const previous = snapshot.state;
    if (
      previous &&
      (state.generation < previous.generation ||
        (state.generation === previous.generation && previous.phase !== "starting"))
    )
      return;
    publish({ ...snapshot, state });
  };
  return {
    receive,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    async start(invoke: () => Promise<number>, listen: () => Promise<void>) {
      if (snapshot.requesting || snapshot.state?.phase === "starting")
        throw new Error("截图正在启动，请稍候");
      publish({ ...snapshot, requesting: true });
      try {
        await listen();
        const generation = await invoke();
        // A shown/failed event may arrive before the IPC acknowledgement.
        if (!snapshot.state || snapshot.state.generation < generation)
          receive({ generation, phase: "starting", error: null });
        return generation;
      } finally {
        publish({ ...snapshot, requesting: false });
      }
    },
  };
}
export function captureStarting(snapshot: CaptureStartupSnapshot) {
  return snapshot.requesting || snapshot.state?.phase === "starting";
}
