import type { DownloadEvent } from "@tauri-apps/plugin-updater";

type Stage = "check" | "download" | "install" | "restart";
export interface UpdateState {
  phase:
    | "idle"
    | "checking"
    | "available"
    | "latest"
    | "downloading"
    | "installing"
    | "restarting"
    | "ready"
    | "error";
  version: string | null;
  downloaded: number;
  total: number | null;
  error: string | null;
  failedAt: Stage | null;
  warning: string | null;
}
export interface UpdateHandle {
  version: string;
  download: (receive: (event: DownloadEvent) => void) => Promise<void>;
  install: () => Promise<void>;
  close: () => Promise<void>;
}
export function updateBusy(state: UpdateState) {
  return ["checking", "downloading", "installing", "restarting"].includes(state.phase);
}
export function updatePercent(state: UpdateState): number | undefined {
  return state.total && state.total > 0
    ? Math.min(100, Math.floor((state.downloaded / state.total) * 100))
    : undefined;
}
export function createUpdateController(deps: {
  check: () => Promise<UpdateHandle | null>;
  relaunch: () => Promise<void>;
}) {
  let state: UpdateState = {
    phase: "idle",
    version: null,
    downloaded: 0,
    total: null,
    error: null,
    failedAt: null,
    warning: null,
  };
  let update: UpdateHandle | null = null;
  let generation = 0;
  const getSnapshot = () => state;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<UpdateState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const fail = (stage: Stage, error: unknown) =>
    publish({ phase: "error", failedAt: stage, error: String(error) });
  const release = async () => {
    const previous = update;
    update = null;
    if (previous)
      try {
        await previous.close();
      } catch (error) {
        publish({ warning: `清理上一次更新失败：${String(error)}。若反复出现，请重启应用后重试。` });
      }
  };
  const restart = async () => {
    publish({ phase: "restarting", error: null, failedAt: null });
    try {
      await deps.relaunch();
      publish({ phase: "ready" });
    } catch (error) {
      fail("restart", error);
    }
  };
  const install = async () => {
    if (!update) return;
    const current = ++generation;
    let stage: Stage = "download";
    publish({ phase: "downloading", downloaded: 0, total: null, error: null, failedAt: null });
    try {
      await update.download((event) => {
        if (state.phase !== "downloading" || current !== generation) return;
        if (event.event === "Started")
          publish({
            downloaded: 0,
            total:
              event.data.contentLength && event.data.contentLength > 0
                ? event.data.contentLength
                : null,
          });
        else if (event.event === "Progress")
          publish({ downloaded: state.downloaded + Math.max(0, event.data.chunkLength) });
      });
      stage = "install";
      publish({ phase: "installing" });
      await update.install();
      await restart();
    } catch (error) {
      fail(stage, error);
    }
  };
  const check = async () => {
    generation += 1;
    publish({
      phase: "checking",
      error: null,
      failedAt: null,
      warning: null,
      version: null,
      downloaded: 0,
      total: null,
    });
    try {
      await release();
      update = await deps.check();
      publish({ phase: update ? "available" : "latest", version: update?.version ?? null });
    } catch (error) {
      fail("check", error);
    }
  };
  return {
    getSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async check() {
      if (!updateBusy(state)) await check();
    },
    async install() {
      if (state.phase === "available") await install();
    },
    async retry() {
      if (state.phase !== "error") return;
      if (state.failedAt === "restart") {
        await restart();
        return;
      }
      if (state.failedAt === "check") {
        await check();
        return;
      }
      // Reacquire a fresh resource: a failed native install may already have consumed its bytes.
      const version = state.version;
      await check();
      const checked = getSnapshot();
      if (checked.phase === "available" && checked.version === version) await install();
    },
  };
}
