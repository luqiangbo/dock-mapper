import type { LogLevel, RuntimeLogLine, RuntimeLogSnapshot } from "../api/runtimeLogs";
export function filterRuntimeLogs(lines: RuntimeLogLine[], level: LogLevel | "all") {
  return lines.filter((line) => level === "all" || line.level === level);
}
export interface LogReadState {
  snapshot: RuntimeLogSnapshot | null;
  loading: boolean;
  error: string | null;
}
export function createLogPoller(
  read: () => Promise<RuntimeLogSnapshot>,
  publish: (state: LogReadState) => void,
) {
  let state: LogReadState = { snapshot: null, loading: false, error: null };
  let visible = false,
    automatic = true,
    disposed = false,
    running = false,
    requested = false,
    generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const emit = (patch: Partial<LogReadState>) => {
    state = { ...state, ...patch };
    publish(state);
  };
  const refresh = async () => {
    clearTimeout(timer);
    if (disposed || !visible) return;
    if (running) {
      requested = true;
      generation += 1;
      return;
    }
    running = true;
    requested = false;
    const current = ++generation;
    emit({ loading: true });
    try {
      const snapshot = await read();
      if (!disposed && visible && current === generation) emit({ snapshot, error: null });
    } catch (error) {
      if (!disposed && visible && current === generation) emit({ error: String(error) });
    } finally {
      running = false;
      if (!disposed && visible) {
        emit({ loading: false });
        if (requested) void refresh();
        else if (automatic) timer = setTimeout(() => void refresh(), 2000);
      }
    }
  };
  return {
    refresh,
    setAutomatic(next: boolean) {
      if (disposed || next === automatic) return;
      automatic = next;
      clearTimeout(timer);
      requested = false;
      if (automatic && visible) void refresh();
    },
    clearSnapshot() {
      generation += 1;
      requested = false;
      emit({ snapshot: { lines: [], truncated: false }, loading: false, error: null });
    },
    setVisible(next: boolean) {
      if (disposed || next === visible) return;
      visible = next;
      generation += 1;
      clearTimeout(timer);
      if (visible) void refresh();
    },
    dispose() {
      disposed = true;
      visible = false;
      generation += 1;
      clearTimeout(timer);
    },
  };
}
export function nearLogBottom(top: number, height: number, scrollHeight: number) {
  return scrollHeight - height - top <= 24;
}
