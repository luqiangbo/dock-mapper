import { useLayoutEffect, useRef } from "react";

export function scheduleAutomaticOcr(recognize: () => void, dismiss: () => void) {
  const timer = window.setTimeout(recognize, 150);
  return () => {
    window.clearTimeout(timer);
    dismiss();
  };
}

// Request identity includes the capture and the committed crop. Callback changes
// (including running -> idle) must never schedule a second recognition.
export function useAutomaticOcr(key: string | null, recognize: () => void, dismiss: () => void) {
  const latest = useRef({ recognize, dismiss });
  latest.current = { recognize, dismiss };
  useLayoutEffect(() => {
    if (!key) return;
    return scheduleAutomaticOcr(
      () => latest.current.recognize(),
      () => latest.current.dismiss(),
    );
  }, [key]);
}
