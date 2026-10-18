import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MAIN_EVENTS } from "../api/commands";
import type { SysStatus } from "../types";
import { appendDashboardSample } from "./dashboardTelemetry";
import { updateTelemetryArchive, saveTelemetryArchive } from "./telemetryArchive";
import { telemetryStore } from "./telemetryStore";
import { observeTelemetryVisibility } from "./telemetryVisibility";
import { recordRuntimeLog } from "./runtimeLogging";
export default function TelemetryCollector() {
  const initialized = useRef(false);
  const archiveError = useRef<string | null>(null);
  const archiveRef = useRef([...telemetryStore.getSnapshot().archive]);
  const archiveSavedAtRef = useRef(0);
  const publishedMinuteRef = useRef(-1);
  const saveArchive = (archive: typeof archiveRef.current) => {
    try {
      saveTelemetryArchive(archive);
      if (archiveError.current) recordRuntimeLog("monitor", "长期趋势保存已恢复");
      archiveError.current = null;
    } catch (error) {
      const message = String(error);
      if (archiveError.current !== message)
        recordRuntimeLog("monitor", `长期趋势保存失败：${message}`, "error");
      archiveError.current = message;
    }
  };
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      recordRuntimeLog("application", "主窗口系统采集已启动");
    }
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
      .catch((error) => recordRuntimeLog("monitor", `窗口状态监听失败：${String(error)}`, "warn"));
    return () => {
      disposed = true;
      off?.();
      visibility.dispose();
    };
  }, []);
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
        saveArchive(nextArchive);
        archiveSavedAtRef.current = now;
      }
    })
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      })
      .catch((error) => recordRuntimeLog("monitor", `系统指标监听失败：${String(error)}`, "error"));
    return () => {
      disposed = true;
      unlisten?.();
      saveArchive(archiveRef.current);
    };
  }, []);

  return null;
}
