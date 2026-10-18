import { useEffect, useRef, useSyncExternalStore } from "react";
import { App as AntApp, Button } from "antd";
import { listen } from "@tauri-apps/api/event";
import { errorMessage, screenshotSettingsApi } from "../api/commands";
import { captureStartup, connectCaptureStartup } from "./captureStartupRuntime";

export default function CaptureStartupFeedback() {
  const { notification } = AntApp.useApp();
  const snapshot = useSyncExternalStore(captureStartup.subscribe, captureStartup.getSnapshot);
  const reported = useRef(0);
  useEffect(() => {
    void connectCaptureStartup().catch((error) =>
      notification.error({
        message: "截图状态监听失败",
        description: errorMessage(error),
      }),
    );
    let disposed = false;
    let off: (() => void) | undefined;
    void listen<string>("capture-request-error", ({ payload }) =>
      notification.error({ message: "启动截图失败", description: payload }),
    )
      .then((cleanup) => {
        if (disposed) cleanup();
        else off = cleanup;
      })
      .catch((error) =>
        notification.error({ message: "截图错误监听失败", description: errorMessage(error) }),
      );
    return () => {
      disposed = true;
      off?.();
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
