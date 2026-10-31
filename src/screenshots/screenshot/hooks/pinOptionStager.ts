import type { PinOptions } from "../../../api/screenshotTypes";

/** Stage every draft in Rust immediately; only the native disk writer debounces.
 * Keeping a JS-only waiting draft could lose the last wheel event during application exit. */
export function createPinOptionStager(options: {
  save: (value: PinOptions) => Promise<PinOptions>;
  onSaved: (value: PinOptions, latest: boolean) => void;
  onError: (error: unknown, latest: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  let revision = 0;
  const pending = new Set<Promise<void>>();
  return {
    write(value: PinOptions) {
      const request = ++revision;
      options.onBusyChange(true);
      const completion = options
        .save(value)
        .then(
          (saved) => options.onSaved(saved, request === revision),
          (error) => options.onError(error, request === revision),
        )
        .finally(() => {
          pending.delete(completion);
          if (!pending.size) options.onBusyChange(false);
        });
      pending.add(completion);
    },
    cancelPending() {
      revision++;
    },
    isBusy: () => pending.size > 0,
    async whenIdle() {
      while (pending.size) await Promise.all([...pending]);
    },
  };
}
