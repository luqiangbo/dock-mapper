/** One write in flight, with only the latest waiting draft retained. */
export function createLatestWriter<Value, Result>(options: {
  save: (value: Value) => Promise<Result>;
  onSaved: (result: Result, latest: boolean) => void;
  onError: (error: unknown, latest: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  let revision = 0;
  let pending: { value: Value; revision: number } | null = null;
  let busy = false;
  let completion = Promise.resolve();
  const flush = async () => {
    busy = true;
    options.onBusyChange?.(true);
    try {
      while (pending) {
        const next = pending;
        pending = null;
        try {
          const result = await options.save(next.value);
          options.onSaved(result, next.revision === revision);
        } catch (error) {
          options.onError(error, next.revision === revision);
        }
      }
    } finally {
      busy = false;
      options.onBusyChange?.(false);
    }
  };
  return {
    write: (value: Value) => {
      pending = { value, revision: ++revision };
      if (!busy) completion = flush();
    },
    cancelPending: () => {
      revision += 1;
      pending = null;
    },
    isBusy: () => busy,
    whenIdle: () => completion,
  };
}
