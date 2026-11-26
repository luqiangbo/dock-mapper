import { useEffect, useRef, useSyncExternalStore } from "react";
import { App as AntApp, Button } from "antd";
import { emit, listen } from "@tauri-apps/api/event";
import { errorMessage, MAIN_EVENTS, screenshotSettingsApi } from "../api/commands";
import { conflictingShortcuts } from "../utils/shortcutStatus";
import { captureStartup, connectCaptureStartup } from "./captureStartupRuntime";

export default function CaptureStartupFeedback() {
  const { notification } = AntApp.useApp();
  const snapshot = useSyncExternalStore(captureStartup.subscribe, captureStartup.getSnapshot);
  const reported = useRef(0);
  const conflictSignatureRef = useRef("");
  useEffect(() => {
    void connectCaptureStartup().catch((error) =>
      notification.error({
        message: "截图状态监听失败",
        description: errorMessage(error),
      }),
    );
    let disposed = false;
    const cleanups: Array<() => void> = [];
    const checkShortcutConflicts = async () => {
      try {
        const statuses = await screenshotSettingsApi.shortcutStatuses();
        if (disposed) return;
        const conflicts = conflictingShortcuts(statuses);
        const signature = conflicts.map((item) => `${item.actionId}:${item.shortcut}`).join("|");
        if (!signature) {
          conflictSignatureRef.current = "";
          notification.destroy("shortcut-conflict-startup");
          return;
        }
        if (signature === conflictSignatureRef.current) return;
        conflictSignatureRef.current = signature;
        notification.warning({
          key: "shortcut-conflict-startup",
          message: "部分截图快捷键已被其他应用占用",
          description: conflicts.map((item) => `${item.action}（${item.shortcut}）`).join("、"),
          duration: 10,
          actions: (
            <Button
              size="small"
              onClick={() => {
                notification.destroy("shortcut-conflict-startup");
                void emit(MAIN_EVENTS.navigate, { page: "screenshot", tab: "settings" });
              }}
            >
              前往调整
            </Button>
          ),
        });
      } catch (error) {
        if (!disposed) {
          notification.warning({
            message: "检查快捷键冲突失败",
            description: errorMessage(error),
          });
        }
      }
    };
    void listen<string>("capture-request-error", ({ payload }) =>
      notification.error({ message: "启动截图失败", description: payload }),
    )
      .then((cleanup) => {
        if (disposed) cleanup();
        else cleanups.push(cleanup);
      })
      .catch((error) =>
        notification.error({ message: "截图错误监听失败", description: errorMessage(error) }),
      );
    void listen(MAIN_EVENTS.shortcutStatusChanged, () => void checkShortcutConflicts())
      .then((cleanup) => {
        if (disposed) cleanup();
        else cleanups.push(cleanup);
      })
      .catch((error) =>
        notification.warning({ message: "快捷键状态监听失败", description: errorMessage(error) }),
      );
    void checkShortcutConflicts();
    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [notification]);
  useEffect(() => {
    const status = snapshot.state;
    if (status?.phase !== "failed" || status.generation <= reported.current) return;
    reported.current = status.generation;
    const key = `capture-start-${status.generation}`;
    notification.error({
      key,
      message: "启动截图失败",
      description: status.error,
      duration: 0,
      actions: (
        <Button
          onClick={() => {
            notification.destroy(key);
            void screenshotSettingsApi
              .start()
              .catch((error) =>
                notification.error({ message: "启动截图失败", description: errorMessage(error) }),
              );
          }}
        >
          重试截图
        </Button>
      ),
    });
  }, [snapshot, notification]);
  return null;
}
