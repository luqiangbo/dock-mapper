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
  void Promise.resolve()
    .then(() => (active ? work() : undefined))
    .then(
      () => {
        pending = false;
        if (active) publish({ phase: "ready" });
      },
      (error: unknown) => {
        pending = false;
        if (active) publish({ phase: "error", error: String(error) });
      },
    )
    .finally(() => clearTimeout(timer));
  return () => {
    active = false;
    clearTimeout(timer);
  };
}
