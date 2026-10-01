/** Cancellation frees queued work immediately; running IPC retains its slot until completion. */
export function createRequestQueue(limit: number) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("请求并发数必须为正整数");
  let running = 0;
  const pending: Array<() => void> = [];
  const drain = () => {
    while (running < limit && pending.length) pending.shift()?.();
  };
  return {
    run<Result>(task: () => Promise<Result>, signal: AbortSignal): Promise<Result> {
      return new Promise((resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException("请求已取消", "AbortError"));
          return;
        }
        let started = false;
        const abort = () => {
          if (!started) {
            const index = pending.indexOf(start);
            if (index >= 0) pending.splice(index, 1);
            signal.removeEventListener("abort", abort);
          }
          reject(new DOMException("请求已取消", "AbortError"));
        };
        const start = () => {
          started = true;
          running += 1;
          Promise.resolve()
            .then(() => {
              if (signal.aborted) throw new DOMException("请求已取消", "AbortError");
              return task();
            })
            .then(
              (value) => {
                if (!signal.aborted) resolve(value);
              },
              (error) => {
                if (!signal.aborted) reject(error);
              },
            )
            .finally(() => {
              signal.removeEventListener("abort", abort);
              running -= 1;
              drain();
            });
        };
        signal.addEventListener("abort", abort, { once: true });
        pending.push(start);
        drain();
      });
    },
  };
}
