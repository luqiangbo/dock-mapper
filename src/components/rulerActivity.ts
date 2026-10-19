type Interaction = "hovered" | "dragging" | "focused";

/** Visual feedback only; the native container remains the source of scroll position. */
export function createRulerActivity() {
  let overflowing = false;
  let scrolling = false;
  let interactions: Record<Interaction, boolean> = {
    hovered: false,
    dragging: false,
    focused: false,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let snapshot = { active: false, expanded: false };
  const listeners = new Set<() => void>();
  const publish = () => {
    const expanded = overflowing && Object.values(interactions).some(Boolean);
    const active = overflowing && (scrolling || expanded);
    if (active === snapshot.active && expanded === snapshot.expanded) return;
    snapshot = { active, expanded };
    listeners.forEach((notify) => notify());
  };
  const reset = () => {
    clearTimeout(timer);
    timer = undefined;
    scrolling = false;
    overflowing = false;
    interactions = { hovered: false, dragging: false, focused: false };
    publish();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    setOverflowing(value: boolean) {
      if (!value) reset();
      else {
        overflowing = true;
        publish();
      }
    },
    set(kind: Interaction, value: boolean) {
      interactions[kind] = value;
      publish();
    },
    scroll() {
      if (!overflowing) return;
      scrolling = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        scrolling = false;
        timer = undefined;
        publish();
      }, 900);
      publish();
    },
    reset,
  };
}
