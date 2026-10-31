import { useEffect, useRef, useState } from "react";
import { Alert, Button } from "antd";
import { listen } from "@tauri-apps/api/event";
import { invokeCommand, type NativeStartupStatus } from "../api/ipc";
import { activateRuntime, acceptStartupStatus } from "../runtimeActivation";
import { recordRuntimeLog } from "./runtimeLogging";

export default function RuntimeStartupNotice() {
  const [status, setStatus] = useState<NativeStartupStatus | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const current = useRef(status);
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    let frame = 0;
    let polling = 0;
    const receive = (next: NativeStartupStatus) => {
      if (!disposed) {
        current.current = acceptStartupStatus(current.current, next);
        setStatus(current.current);
        if (current.current?.phase === "ready") {
          window.clearInterval(polling);
          setError("");
        }
      }
    };
    const read = () => {
      if (disposed || current.current?.phase === "ready") return;
      void invokeCommand("get_startup_status")
        .then(receive)
        .catch((cause) => {
          if (!disposed && current.current?.phase !== "ready")
            setError(`启动状态读取失败：${String(cause)}`);
        });
    };
    void listen<NativeStartupStatus>("startup-state", ({ payload }) => receive(payload))
      .then((unlisten) => {
        if (disposed) unlisten();
        else off = unlisten;
      })
      .catch((cause) => {
        if (!disposed) setError(`启动状态监听失败：${String(cause)}`);
      });
    setError("");
    read();
    // Let the shell paint before activating native windows and background work.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        recordRuntimeLog(
          "application",
          `主界面已绘制：${Math.round(performance.now())} ms`,
          "info",
        );
        void activateRuntime()
          .then(read)
          .catch((cause) => {
            if (!disposed) {
              recordRuntimeLog("application", `运行功能初始化失败：${String(cause)}`, "error");
              setError(String(cause));
              read();
            }
          });
      });
    });
    polling = window.setInterval(read, 1000);
    return () => {
      disposed = true;
      off?.();
      cancelAnimationFrame(frame);
      window.clearInterval(polling);
    };
  }, [attempt]);
  if (status?.phase === "ready" && !error) return null;
  const failed = status?.phase === "failed" || !!error;
  return (
    <Alert
      style={{ position: "fixed", top: 64, right: 16, zIndex: 1000, maxWidth: 440 }}
      showIcon
      type={failed ? "error" : "info"}
      title={failed ? "部分运行功能尚未就绪" : "正在准备运行功能"}
      description={
        error || status?.error || `正在初始化${status?.stage ?? "后台功能"}，主界面已可使用`
      }
      action={
        failed ? (
          <Button
            size="small"
            disabled={status?.running}
            onClick={() => setAttempt((value) => value + 1)}
          >
            {status?.running ? "等待任务结束" : "重试"}
          </Button>
        ) : undefined
      }
    />
  );
}
