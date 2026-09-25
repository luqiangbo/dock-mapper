import { useEffect, useState } from "react";

export type TelemetryFreshness = "waiting" | "live" | "stale";
export const TELEMETRY_STALE_AFTER_MS = 15_000;

export function telemetryFreshness(lastReceivedAt: number | null, now: number): TelemetryFreshness {
  if (lastReceivedAt === null) return "waiting";
  return now - lastReceivedAt > TELEMETRY_STALE_AFTER_MS ? "stale" : "live";
}

export function useTelemetryFreshness(lastReceivedAt: number | null): TelemetryFreshness {
  const [, forceRefresh] = useState(0);
  useEffect(() => {
    const refreshWhenVisible = () => forceRefresh((value) => value + 1);
    window.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    if (lastReceivedAt === null) {
      return () => {
        window.removeEventListener("visibilitychange", refreshWhenVisible);
        window.removeEventListener("focus", refreshWhenVisible);
      };
    }
    const delay = Math.max(0, lastReceivedAt + TELEMETRY_STALE_AFTER_MS + 1 - Date.now());
    const timer = window.setTimeout(() => forceRefresh((value) => value + 1), delay);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [lastReceivedAt]);
  return telemetryFreshness(lastReceivedAt, Date.now());
}
