import { useEffect, useState, type ReactNode } from "react";
import { Alert, Button } from "antd";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { invokeCommand } from "./api/ipc";
import { clearBuildPreferences } from "./buildDefaults";
import { restartForBuild } from "./bootstrapRestart";
import { recordRuntimeLog } from "./components/runtimeLogging";
import StartupFeedback from "./StartupFeedback";
import { observeStartup, type StartupState } from "./startupState";

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
  const [state, setState] = useState<StartupState>({ phase: "loading", slow: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    const work = secondary
      ? () =>
          new Promise<void>((resolve, reject) => {
            void (async () => {
              const cleanup = await listen("defaults-ready", () => {
                if (!disposed) resolve();
              });
              if (disposed) {
                cleanup();
                return;
              }
              off = cleanup;
              if ((await invokeCommand("application_ready")) && !disposed) resolve();
            })().catch(reject);
          })
      : initialize;
    const cancel = observeStartup(work, setState);
    return () => {
      disposed = true;
      cancel();
      off?.();
    };
  }, [secondary, attempt]);
  if (state.phase === "ready") return children;
  if (state.phase === "error") {
    const alert = (
      <Alert
        type="error"
        title="应用设置初始化失败"
        description={state.error}
        action={<Button onClick={() => setAttempt((value) => value + 1)}>重试</Button>}
      />
    );
    return secondary ? alert : <StartupFeedback error={alert} />;
  }
  return secondary ? null : <StartupFeedback slow={state.slow} />;
}
