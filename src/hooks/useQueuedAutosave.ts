import { useCallback, useEffect, useRef } from "react";

export interface AutosaveResultContext {
  latest: boolean;
}

interface QueuedAutosaveOptions<Value, Result> {
  delayMs: number;
  save: (value: Value) => Promise<Result>;
  onSuccess: (result: Result, context: AutosaveResultContext) => void | Promise<void>;
  onError: (error: unknown, context: AutosaveResultContext) => void;
  onSavingChange: (saving: boolean) => void;
}

/** Debounces drafts, serializes writes and prevents stale completions from replacing newer UI state. */
export function useQueuedAutosave<Value, Result>(options: QueuedAutosaveOptions<Value, Result>) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const mounted = useRef(true);
  const revision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const activeSaves = useRef(0);

  const invalidate = useCallback(() => {
    revision.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    return revision.current;
  }, []);

  const isCurrent = useCallback((value: number) => value === revision.current, []);

  const schedule = useCallback((value: Value, delay = optionsRef.current.delayMs) => {
    const current = ++revision.current;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      queue.current = queue.current.then(async () => {
        if (!mounted.current || current !== revision.current) return;
        activeSaves.current += 1;
        optionsRef.current.onSavingChange(true);
        try {
          const result = await optionsRef.current.save(value);
          if (mounted.current) {
            await optionsRef.current.onSuccess(result, {
              latest: current === revision.current,
            });
          }
        } catch (error) {
          if (mounted.current) {
            optionsRef.current.onError(error, { latest: current === revision.current });
          }
        } finally {
          activeSaves.current -= 1;
          if (mounted.current && activeSaves.current === 0) {
            optionsRef.current.onSavingChange(false);
          }
        }
      });
    }, delay);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      invalidate();
    };
  }, [invalidate]);

  return { schedule, invalidate, isCurrent };
}
