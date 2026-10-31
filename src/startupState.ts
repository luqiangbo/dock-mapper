export type StartupState =
  | { phase: "loading"; slow: boolean }
  | { phase: "ready" }
  | { phase: "error"; error: string };

/** Observe one attempt; disposal invalidates its reads without restarting native work. */
export function observeStartup(work: () => Promise<void>, publish: (state: StartupState) => void) {
  let active = true;
  let pending = true;
  publish({ phase: "loading", slow: false });
  const timer = setTimeout(() => {
    if (active && pending) publish({ phase: "loading", slow: true });
  }, 8000);
  const deadline = setTimeout(() => {
    if (active && pending) {
      pending = false;
      publish({
        phase: "error",
        error: "应用初始化超时（20 秒），请重试；若持续无响应，请退出后重新打开",
      });
    }
  }, 20000);
  void Promise.resolve()
    .then(() => (active ? work() : undefined))
    .then(
      () => {
        if (!pending) return;
        pending = false;
        if (active) publish({ phase: "ready" });
      },
      (error: unknown) => {
        if (!pending) return;
        pending = false;
        if (active) publish({ phase: "error", error: String(error) });
      },
    )
    .finally(() => {
      clearTimeout(timer);
      clearTimeout(deadline);
    });
  return () => {
    active = false;
    clearTimeout(timer);
    clearTimeout(deadline);
  };
}
