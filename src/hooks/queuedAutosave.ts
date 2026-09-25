export interface QueueOptions<Value, Result> {
  key: string;
  delayMs: number;
  save: (value: Value) => Promise<Result>;
  onSuccess: (result: Result, context: { latest: boolean }) => void | Promise<void>;
  onError: (error: unknown, context: { latest: boolean }) => void;
  onDetachedError: (error: unknown) => void;
  onSavingChange: (saving: boolean) => void;
}

const pendingWrites = new Map<string, Promise<void>>();
const detachedErrors = new Map<string, unknown>();

export function takeDetachedAutosaveError(key: string): unknown {
  const error = detachedErrors.get(key);
  detachedErrors.delete(key);
  return error;
}

export function waitForPendingAutosave(key: string): Promise<void> {
  return pendingWrites.get(key) ?? Promise.resolve();
}

export function createQueuedAutosave<Value, Result>(options: QueueOptions<Value, Result>) {
  let revision = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingValue: { value: Value; revision: number } | null = null;
  let queue = Promise.resolve();
  let detached = false;
  let active = 0;

  const enqueue = (value: Value, current: number) => {
    queue = queue.then(async () => {
      if (current !== revision) return;
      active += 1;
      if (!detached) options.onSavingChange(true);
      try {
        const result = await options.save(value);
        if (!detached) await options.onSuccess(result, { latest: current === revision });
      } catch (error) {
        if (current === revision) {
          if (detached) {
            detachedErrors.set(options.key, error);
            options.onDetachedError(error);
          }
          else options.onError(error, { latest: true });
        }
      } finally {
        active -= 1;
        if (!detached && active === 0) options.onSavingChange(false);
      }
    });
    const tracked = queue;
    pendingWrites.set(options.key, tracked);
    void tracked.then(() => {
      if (pendingWrites.get(options.key) === tracked) pendingWrites.delete(options.key);
    });
  };

  const invalidate = () => {
    revision += 1;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pendingValue = null;
    return revision;
  };

  return {
    schedule(value: Value, delay = options.delayMs): void {
      detachedErrors.delete(options.key);
      const current = invalidate();
      pendingValue = { value, revision: current };
      timer = setTimeout(() => {
        timer = null;
        pendingValue = null;
        enqueue(value, current);
      }, delay);
    },
    detach(): void {
      detached = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const pending = pendingValue;
      pendingValue = null;
      if (pending) enqueue(pending.value, pending.revision);
    },
    attach(): void { detached = false; },
    invalidate,
    isCurrent(value: number): boolean { return value === revision; },
  };
}
