import type { SysStatus } from "../types";
import type { DashboardSample } from "./dashboardTelemetry";

export type TrendRange = "live" | "hour" | "day";
const STORAGE_KEY = "dockmapper.telemetry-archive.v1";
const DAY_MS = 24 * 60 * 60_000;

export function appendTelemetryArchive(archive: DashboardSample[], status: SysStatus, now: number): DashboardSample[] {
  const timestamp = Math.floor(now / 60_000) * 60_000;
  const next: DashboardSample = {
    timestamp,
    upload: status.network_available ? status.upload_speed : null,
    download: status.network_available ? status.download_speed : null,
    cpu: status.cpu_usage ?? null,
    memory: status.memory_usage,
  };
  const cutoff = now - DAY_MS;
  const retained = archive.filter((item) => item.timestamp >= cutoff && item.timestamp !== timestamp);
  return [...retained, next].slice(-1_440);
}

export function selectTelemetryArchive(archive: DashboardSample[], range: Exclude<TrendRange, "live">, now: number): DashboardSample[] {
  const filtered = archive.filter((item) => item.timestamp >= now - (range === "hour" ? 60 * 60_000 : DAY_MS));
  const interval = range === "hour" ? 60_000 : 300_000;
  const samples = range === "hour" ? filtered : (() => {
    const buckets = new Map<number, DashboardSample>();
    for (const sample of filtered) buckets.set(Math.floor(sample.timestamp / interval), sample);
    return [...buckets.values()];
  })();
  const result: DashboardSample[] = [];
  for (const sample of samples) {
    const previous = result[result.length - 1];
    if (previous && sample.timestamp - previous.timestamp > interval * 1.5) {
      result.push({ timestamp: previous.timestamp + interval, upload: null, download: null, cpu: null, memory: null });
    }
    result.push(sample);
  }
  return result;
}

export function loadTelemetryArchive(): DashboardSample[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is DashboardSample =>
      typeof item === "object" && item !== null &&
      typeof item.timestamp === "number" &&
      (item.memory === null || typeof item.memory === "number") &&
      (item.upload === null || typeof item.upload === "number") &&
      (item.download === null || typeof item.download === "number") &&
      (item.cpu === null || typeof item.cpu === "number"),
    ).slice(-1_440);
  } catch {
    return [];
  }
}

export function saveTelemetryArchive(archive: DashboardSample[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(archive));
}
