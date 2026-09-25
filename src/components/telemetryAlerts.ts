import type { SysStatus } from "../types";

export interface AlertRules { cpu_percent: number | null; memory_percent: number | null; battery_below_percent: number | null; }
export type AlertKind = "cpu" | "memory" | "battery";
export interface AlertEntry { id: string; kind: AlertKind; value: number; threshold: number; createdAt: number; read: boolean; }
export interface AlertState { counts: Record<AlertKind, number>; lastAlertAt: Record<AlertKind, number>; }

const COOLDOWN_MS = 10 * 60_000;
const INBOX_KEY = "dockmapper.telemetry-alerts.v1";

export function initialAlertState(inbox: AlertEntry[] = []): AlertState {
  const state: AlertState = { counts: { cpu: 0, memory: 0, battery: 0 }, lastAlertAt: { cpu: -Infinity, memory: -Infinity, battery: -Infinity } };
  for (const entry of inbox) state.lastAlertAt[entry.kind] = Math.max(state.lastAlertAt[entry.kind], entry.createdAt);
  return state;
}

export function evaluateTelemetryAlerts(state: AlertState, rules: AlertRules, status: SysStatus, now: number): { state: AlertState; alerts: AlertEntry[] } {
  const next: AlertState = { counts: { ...state.counts }, lastAlertAt: { ...state.lastAlertAt } };
  const alerts: AlertEntry[] = [];
  const candidates: Array<[AlertKind, number | null, number | null, boolean]> = [
    ["cpu", status.cpu_usage ?? null, rules.cpu_percent, false],
    ["memory", status.memory_usage, rules.memory_percent, false],
    ["battery", status.battery?.percentage ?? null, rules.battery_below_percent, true],
  ];
  for (const [kind, value, threshold, below] of candidates) {
    const exceeded = value !== null && threshold !== null && (below ? value <= threshold : value >= threshold);
    next.counts[kind] = exceeded ? Math.min(3, next.counts[kind] + 1) : 0;
    if (!exceeded || next.counts[kind] < 3 || now - next.lastAlertAt[kind] < COOLDOWN_MS) continue;
    next.lastAlertAt[kind] = now;
    alerts.push({ id: `${kind}-${now}`, kind, value, threshold, createdAt: now, read: false });
  }
  return { state: next, alerts };
}

export function loadAlertInbox(): AlertEntry[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(INBOX_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is AlertEntry =>
      typeof item === "object" && item !== null &&
      typeof item.id === "string" &&
      ["cpu", "memory", "battery"].includes(item.kind) &&
      typeof item.value === "number" && typeof item.threshold === "number" &&
      typeof item.createdAt === "number" && typeof item.read === "boolean",
    ).slice(-50);
  } catch { return []; }
}

export function saveAlertInbox(alerts: AlertEntry[]): void {
  window.localStorage.setItem(INBOX_KEY, JSON.stringify(alerts.slice(-50)));
}
