import type { SysStatus } from "../types";
import type { DashboardSample } from "./dashboardTelemetry";
import { loadTelemetryArchive } from "./telemetryArchive";
import { loadAlertInbox, type AlertEntry } from "./telemetryAlerts";

export interface TelemetrySnapshot {
  status: SysStatus | null;
  lastSampleAt: number | null;
  samples: DashboardSample[];
  archive: DashboardSample[];
  alerts: AlertEntry[];
}
export function createTelemetryStore(initial: TelemetrySnapshot) {
  let current = initial;
  let published = initial;
  let visible = true;
  const listeners = new Set<() => void>();
  const publish = () => {
    published = current;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => current,
    getPublishedSnapshot: () => published,
    update: (patch: Partial<TelemetrySnapshot>) => {
      current = { ...current, ...patch };
      if (visible) publish();
    },
    setVisible: (next: boolean) => {
      if (next === visible) return;
      visible = next;
      if (visible) publish();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export const telemetryStore = createTelemetryStore({
  status: null,
  lastSampleAt: null,
  samples: [],
  archive: loadTelemetryArchive(),
  alerts: loadAlertInbox(),
});
