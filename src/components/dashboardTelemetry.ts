import type { SysStatus } from "../types";

export const DASHBOARD_HISTORY_MS = 5 * 60 * 1000;
export const DASHBOARD_MAX_SAMPLES = 301;

export interface DashboardSample {
  timestamp: number;
  upload: number | null;
  download: number | null;
  cpu: number | null;
  memory: number;
}

export function appendDashboardSample(
  samples: DashboardSample[],
  status: SysStatus,
  timestamp = Date.now(),
): DashboardSample[] {
  const next: DashboardSample = {
    timestamp,
    upload: status.network_available ? status.upload_speed : null,
    download: status.network_available ? status.download_speed : null,
    cpu: status.cpu_usage ?? null,
    memory: status.memory_usage,
  };
  const cutoff = timestamp - DASHBOARD_HISTORY_MS;
  return [...samples.filter((sample) => sample.timestamp >= cutoff), next].slice(-DASHBOARD_MAX_SAMPLES);
}
