import { useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Spin } from "antd";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { invokeCommand } from "./api/ipc";
import { clearBuildPreferences } from "./buildDefaults";
import { restartForBuild } from "./bootstrapRestart";
import { recordRuntimeLog } from "./components/runtimeLogging";

declare const __DOCKMAPPER_DEFAULTS_BUILD_ID__: string;
declare const __DOCKMAPPER_DEV_MODE__: boolean;
let initialization: Promise<void> | null = null;
function initialize() {
  if (!initialization)
    initialization = (async () => {
      const result = await invokeCommand("initialize_defaults", {
        buildId: __DOCKMAPPER_DEFAULTS_BUILD_ID__,
        activate: false,
      });
      if (result.restartRequired) {
        await restartForBuild(__DOCKMAPPER_DEV_MODE__, relaunch);
        return;
      }
      clearBuildPreferences(localStorage, result.identity);
      await invokeCommand("initialize_defaults", {
        buildId: __DOCKMAPPER_DEFAULTS_BUILD_ID__,
        activate: true,
      });
    })().catch((error) => {
      initialization = null;
      recordRuntimeLog("application", `应用设置初始化失败：${String(error)}`, "error");
      throw error;
    });
  return initialization;
}
export default function DefaultsGate({
  children,
  secondary = false,
}: {
  children: ReactNode;
  secondary?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    setError(null);
    const work = secondary
      ? (async () => {
          const cleanup = await listen("defaults-ready", () => {
            if (!disposed) setReady(true);
          });
          if (disposed) {
            cleanup();
            return;
          }
          off = cleanup;
          if ((await invokeCommand("application_ready")) && !disposed) setReady(true);
        })()
      : initialize().then(() => {
          if (!disposed) setReady(true);
        });
    void work.catch((error) => {
      if (!disposed) setError(String(error));
    });
    return () => {
      disposed = true;
      off?.();
    };
  }, [secondary, attempt]);
  if (ready) return children;
  if (error)
    return (
      <Alert
        type="error"
        title="应用设置初始化失败"
        description={error}
        action={<Button onClick={() => setAttempt((value) => value + 1)}>重试</Button>}
      />
    );
  return secondary ? null : <Spin description="正在初始化应用设置…" fullscreen />;
}
