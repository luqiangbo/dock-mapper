/** Share one settling boundary across charts, decoration and native controls. */
export function createWindowResizeActivity(settleMs = 200) {
  let resizing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: boolean) => {
    if (resizing === next) return;
    resizing = next;
    listeners.forEach((listener) => listener());
  };
  const finish = () => {
    clearTimeout(timer);
    timer = undefined;
    publish(false);
  };
  return {
    getSnapshot: () => resizing,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    begin() {
      clearTimeout(timer);
      publish(true);
      timer = setTimeout(finish, settleMs);
    },
    finish,
  };
}

export const windowResizeActivity = createWindowResizeActivity();

/** Coalesce data and geometry changes; read the latest inputs when flushing. */
export function createSettledRenderQueue(
  activity: ReturnType<typeof createWindowResizeActivity>,
  render: () => void,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancel: (frame: number) => void = cancelAnimationFrame,
) {
  let pending = false;
  let disposed = false;
  let frame: number | undefined;
  const enqueue = () => {
    if (disposed || !pending || activity.getSnapshot() || frame !== undefined) return;
    frame = schedule(() => {
      frame = undefined;
      if (disposed || activity.getSnapshot()) return;
      pending = false;
      render();
    });
  };
  const off = activity.subscribe(() => {
    if (activity.getSnapshot()) {
      if (frame !== undefined) cancel(frame);
      frame = undefined;
    } else enqueue();
  });
  return {
    request() {
      pending = true;
      enqueue();
    },
    dispose() {
      disposed = true;
      pending = false;
      off();
      if (frame !== undefined) cancel(frame);
      frame = undefined;
    },
  };
}
