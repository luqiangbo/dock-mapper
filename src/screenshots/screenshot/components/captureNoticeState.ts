export interface NoticePriority {
  error: boolean;
  progress: boolean;
  hint: boolean;
}

/** One visible notice per WebView; temporary feedback replaces persistent instructions. */
export function createCaptureNoticeState<T = undefined>() {
  const notices = new Map<string, { priority: number; order: number; content?: T }>();
  const listeners = new Set<() => void>();
  let order = 0;
  let version = 0;
  let winner: string | null = null;
  const publish = () => {
    let selected: string | null = null;
    let best = -1,
      newest = -1;
    for (const [id, notice] of notices) {
      if (notice.priority > best || (notice.priority === best && notice.order > newest)) {
        selected = id;
        best = notice.priority;
        newest = notice.order;
      }
    }
    winner = selected;
    version++;
    listeners.forEach((listener) => listener());
  };
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => winner,
    getVersion: () => version,
    getContent: () => (winner ? (notices.get(winner)?.content ?? null) : null),
    getHintContent: () => {
      let latest: { priority: number; order: number; content?: T } | undefined;
      for (const notice of notices.values()) {
        if (notice.priority === 0 && (!latest || notice.order > latest.order)) latest = notice;
      }
      return latest?.content ?? null;
    },
    remove(id: string) {
      notices.delete(id);
      publish();
    },
    register(id: string, { error, progress, hint }: NoticePriority, content?: T) {
      notices.set(id, {
        priority: error ? 3 : progress ? 2 : hint ? 0 : 1,
        order: ++order,
        content,
      });
      publish();
      return () => {
        notices.delete(id);
        publish();
      };
    },
  };
}

/** Dragging can invalidate OCR work, but must not unmount the visible notice. */
export function createNoticePresentation<T>() {
  let displayed: T | null = null;
  return (next: T | null, moving: boolean) => {
    if (!moving) displayed = next;
    return displayed;
  };
}
