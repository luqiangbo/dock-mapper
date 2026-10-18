/** Suppress only the browser default; application context menus still receive the event. */
const installations = new WeakMap<EventTarget, () => void>();
export function installBrowserContextMenuPolicy(target: EventTarget) {
  const installed = installations.get(target);
  if (installed) return installed;
  const preventDefault = (event: Event) => event.preventDefault();
  target.addEventListener("contextmenu", preventDefault, { capture: true });
  const dispose = () => {
    if (installations.get(target) !== dispose) return;
    target.removeEventListener("contextmenu", preventDefault, { capture: true });
    installations.delete(target);
  };
  installations.set(target, dispose);
  return dispose;
}
