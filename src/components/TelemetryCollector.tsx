import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { App as AntApp } from "antd";
import { MAIN_EVENTS } from "../api/commands";
import type { SysStatus } from "../types";
import { appendDashboardSample } from "./dashboardTelemetry";
import { updateTelemetryArchive, saveTelemetryArchive } from "./telemetryArchive";
import { telemetryStore } from "./telemetryStore";
import { observeTelemetryVisibility } from "./telemetryVisibility";
export default function TelemetryCollector() {
  const { notification } = AntApp.useApp();
  const archiveRef = useRef([...telemetryStore.getSnapshot().archive]);
  const archiveSavedAtRef = useRef(0);
  const publishedMinuteRef = useRef(-1);
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    const visibility = observeTelemetryVisibility(document, telemetryStore.setVisible);
    void getCurrentWindow()
      .onFocusChanged(() => {
        if (!disposed) visibility.refresh();
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else off = unlisten;
      })
      .catch((error) =>
        notification.warning({ message: "窗口状态监听失败", description: String(error) }),
      );
    return () => {
      disposed = true;
      off?.();
      visibility.dispose();
    };
  }, [notification]);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<SysStatus>(MAIN_EVENTS.systemStatus, ({ payload }) => {
      if (disposed) return;
      const now = Date.now();
      telemetryStore.update({
        lastSampleAt: now,
        status: payload,
        samples: appendDashboardSample(telemetryStore.getSnapshot().samples, payload, now),
      });
      const nextArchive = updateTelemetryArchive(archiveRef.current, payload, now);
      archiveRef.current = nextArchive;
      if (Math.floor(now / 60_000) !== publishedMinuteRef.current) {
        publishedMinuteRef.current = Math.floor(now / 60_000);
        telemetryStore.update({ archive: [...nextArchive] });
      }
      if (now - archiveSavedAtRef.current >= 60_000) {
        try {
          saveTelemetryArchive(nextArchive);
          archiveSavedAtRef.current = now;
        } catch (error) {
          notification.warning({ message: "长期趋势保存失败", description: String(error) });
          archiveSavedAtRef.current = now;
        }
      }
    })
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      })
      .catch((error) =>
        notification.error({ message: "系统指标监听失败", description: String(error) }),
      );
    return () => {
      disposed = true;
      unlisten?.();
      try {
        saveTelemetryArchive(archiveRef.current);
      } catch (error) {
        notification.warning({ message: "长期趋势保存失败", description: String(error) });
      }
    };
  }, [notification]);

  return null;
}
