import { useCallback, useEffect, useRef } from "react";
import { createQueuedAutosave, type QueueOptions } from "./queuedAutosave";

export interface AutosaveResultContext {
  latest: boolean;
}

interface QueuedAutosaveOptions<Value, Result> extends QueueOptions<Value, Result> {}

/** Debounces drafts and flushes pending writes when a settings page unmounts. */
export function useQueuedAutosave<Value, Result>(options: QueuedAutosaveOptions<Value, Result>) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const controllerRef = useRef<ReturnType<typeof createQueuedAutosave<Value, Result>> | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createQueuedAutosave<Value, Result>({
      ...options,
      save: (value) => optionsRef.current.save(value),
      onSuccess: (result, context) => optionsRef.current.onSuccess(result, context),
      onError: (error, context) => optionsRef.current.onError(error, context),
      onDetachedError: (error) => optionsRef.current.onDetachedError(error),
      onSavingChange: (saving) => optionsRef.current.onSavingChange(saving),
    });
  }
  const controller = controllerRef.current;

  useEffect(() => {
    controller.attach();
    return () => controller.detach();
  }, [controller]);

  const schedule = useCallback((value: Value, delay?: number) => controller.schedule(value, delay), [controller]);
  const invalidate = useCallback(() => controller.invalidate(), [controller]);
  const isCurrent = useCallback((value: number) => controller.isCurrent(value), [controller]);
  return { schedule, invalidate, isCurrent };
}
