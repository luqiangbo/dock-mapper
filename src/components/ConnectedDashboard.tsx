import { useSyncExternalStore } from "react";
import Dashboard from "./Dashboard";
import { telemetryStore } from "./telemetryStore";
import { useTelemetryFreshness } from "../utils/telemetryFreshness";
import type { ScreenshotTabKey } from "../utils/navigationPreferences";

export default function ConnectedDashboard({
  onNavigate,
}: {
  onNavigate: (page: "keymapper" | "screenshot" | "widget", tab?: ScreenshotTabKey) => void;
}) {
  const snapshot = useSyncExternalStore(
    telemetryStore.subscribe,
    telemetryStore.getPublishedSnapshot,
  );
  const freshness = useTelemetryFreshness(snapshot.lastSampleAt);
  return (
    <Dashboard
      status={freshness === "live" ? snapshot.status : null}
      freshness={freshness}
      samples={snapshot.samples}
      archive={snapshot.archive}
      onNavigate={onNavigate}
    />
  );
}
