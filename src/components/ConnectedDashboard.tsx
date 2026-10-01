import { useSyncExternalStore } from "react";
import { App as AntApp } from "antd";
import Dashboard from "./Dashboard";
import { telemetryStore } from "./telemetryStore";
import { saveAlertInbox } from "./telemetryAlerts";
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
  const { notification } = AntApp.useApp();
  return (
    <Dashboard
      status={freshness === "live" ? snapshot.status : null}
      freshness={freshness}
      samples={snapshot.samples}
      archive={snapshot.archive}
      alerts={snapshot.alerts}
      onNavigate={onNavigate}
      onMarkAlertsRead={() => {
        const alerts = telemetryStore
          .getSnapshot()
          .alerts.map((alert) => ({ ...alert, read: true }));
        try {
          saveAlertInbox(alerts);
          telemetryStore.update({ alerts });
        } catch (error) {
          notification.error({ message: "提醒状态保存失败", description: String(error) });
        }
      }}
    />
  );
}
