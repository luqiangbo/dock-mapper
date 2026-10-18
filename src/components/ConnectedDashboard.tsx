import { useCallback, useRef, useSyncExternalStore } from "react";
import Dashboard from "./Dashboard";
import { telemetryStore } from "./telemetryStore";
import { useTelemetryFreshness } from "../utils/telemetryFreshness";
import { usePageActive } from "./PageActivity";

export default function ConnectedDashboard() {
  const active = usePageActive();
  const cached = useRef(telemetryStore.getPublishedSnapshot());
  const subscribe = useCallback(
    (listener: () => void) => (active ? telemetryStore.subscribe(listener) : () => {}),
    [active],
  );
  const read = useCallback(() => {
    if (active) cached.current = telemetryStore.getPublishedSnapshot();
    return cached.current;
  }, [active]);
  const snapshot = useSyncExternalStore(subscribe, read);
  const freshness = useTelemetryFreshness(snapshot.lastSampleAt, active);
  return (
    <Dashboard
      status={freshness === "live" ? snapshot.status : null}
      freshness={freshness}
      samples={snapshot.samples}
      archive={snapshot.archive}
    />
  );
}
