import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { createUpdateController } from "./updateController";
import { recordRuntimeLog } from "./runtimeLogging";

// Keep the active download and its state when the settings page unmounts.
export const updateController = createUpdateController({
  check: async () => {
    const update = await check({ timeout: 15_000 });
    return update
      ? {
          version: update.version,
          download: (receive) => update.download(receive, { timeout: 30_000 }),
          install: () => update.install(),
          close: () => update.close(),
        }
      : null;
  },
  relaunch,
});

let lastStage = "";
const STAGES = {
  idle: "等待检查",
  checking: "检查更新",
  available: "发现新版本",
  latest: "当前已是最新版本",
  downloading: "下载更新",
  installing: "启动安装程序",
  restarting: "重启应用",
  ready: "已发起重启",
  error: "更新失败",
};
updateController.subscribe(() => {
  const state = updateController.getSnapshot();
  const signature = `${state.phase}:${state.error ?? ""}`;
  if (signature === lastStage) return;
  lastStage = signature;
  recordRuntimeLog(
    "update",
    `${STAGES[state.phase]}${state.version ? ` v${state.version}` : ""}${state.error ? `（${state.failedAt}）：${state.error}` : ""}`,
    state.phase === "error" ? "error" : "info",
  );
});
