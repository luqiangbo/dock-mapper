/** Empty display windows do not keep a timer alive. */
export function createActivityTicker(tick: () => void, intervalMs: number) {
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  return {
    setActive: (active: boolean) => {
      if (!active) stop();
      else if (timer === null) timer = setInterval(tick, intervalMs);
    },
    stop,
  };
}
