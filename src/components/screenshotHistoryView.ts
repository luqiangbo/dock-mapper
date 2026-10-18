import type { ScreenshotHistorySummary } from "../screenshots/screenshot/api";

export const SCREENSHOT_HISTORY_VIEW_KEY = "dock-mapper:screenshot-history-view";

export type HistorySort = "newest" | "oldest" | "favorite";
export type HistoryFilter = "all" | "favorite";
export function screenshotHistoryPhase(
  loading: boolean,
  error: string | null,
  total: number,
  visible: number,
) {
  if (total > 0) return visible > 0 ? "ready" : "filtered";
  if (loading) return "loading";
  if (error) return "error";
  return "empty";
}

export interface ScreenshotHistoryView {
  sort: HistorySort;
  filter: HistoryFilter;
  columns: number;
  startDate: string;
  endDate: string;
}

export const DEFAULT_SCREENSHOT_HISTORY_VIEW: ScreenshotHistoryView = {
  sort: "newest",
  filter: "all",
  columns: 3,
  startDate: "",
  endDate: "",
};

const SORT_VALUES: readonly HistorySort[] = ["newest", "oldest", "favorite"];
const FILTER_VALUES: readonly HistoryFilter[] = ["all", "favorite"];
const LEGACY_DENSITY_COLUMNS: Record<string, number> = {
  compact: 4,
  standard: 3,
  large: 2,
};

function isAllowed<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

export function parseScreenshotHistoryView(value: string | null): ScreenshotHistoryView {
  if (!value) return { ...DEFAULT_SCREENSHOT_HISTORY_VIEW };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    let startDate = validDate(parsed.startDate) ? parsed.startDate : "";
    let endDate = validDate(parsed.endDate) ? parsed.endDate : "";
    if (startDate && endDate && startDate > endDate) {
      startDate = "";
      endDate = "";
    }
    return {
      startDate,
      endDate,
      sort: isAllowed(parsed.sort, SORT_VALUES)
        ? parsed.sort
        : DEFAULT_SCREENSHOT_HISTORY_VIEW.sort,
      filter: isAllowed(parsed.filter, FILTER_VALUES)
        ? parsed.filter
        : DEFAULT_SCREENSHOT_HISTORY_VIEW.filter,
      columns:
        typeof parsed.columns === "number" &&
        Number.isInteger(parsed.columns) &&
        parsed.columns >= 1 &&
        parsed.columns <= 10
          ? parsed.columns
          : (LEGACY_DENSITY_COLUMNS[String(parsed.density)] ??
            DEFAULT_SCREENSHOT_HISTORY_VIEW.columns),
    };
  } catch {
    return { ...DEFAULT_SCREENSHOT_HISTORY_VIEW };
  }
}

export function loadScreenshotHistoryView(): ScreenshotHistoryView {
  try {
    return parseScreenshotHistoryView(window.localStorage.getItem(SCREENSHOT_HISTORY_VIEW_KEY));
  } catch {
    return { ...DEFAULT_SCREENSHOT_HISTORY_VIEW };
  }
}

export function saveScreenshotHistoryView(view: ScreenshotHistoryView): void {
  window.localStorage.setItem(SCREENSHOT_HISTORY_VIEW_KEY, JSON.stringify(view));
}

export function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    localDateKey(new Date(`${value}T00:00:00`).getTime()) === value
  );
}
export function groupScreenshotHistory(entries: ScreenshotHistorySummary[]) {
  const groups = new Map<string, ScreenshotHistorySummary[]>();
  for (const entry of entries) {
    const date = localDateKey(entry.createdAtMs);
    const group = groups.get(date) ?? [];
    group.push(entry);
    groups.set(date, group);
  }
  return [...groups].map(([date, entries]) => ({ date, entries }));
}

export function selectScreenshotHistory(
  entries: ScreenshotHistorySummary[],
  view: ScreenshotHistoryView,
): ScreenshotHistorySummary[] {
  const filtered = entries.filter((entry) => {
    const date = localDateKey(entry.createdAtMs);
    return (
      (view.filter !== "favorite" || entry.favorite) &&
      (!view.startDate || date >= view.startDate) &&
      (!view.endDate || date <= view.endDate)
    );
  });
  return filtered.sort((left, right) => {
    const dates = localDateKey(right.createdAtMs).localeCompare(localDateKey(left.createdAtMs));
    if (dates) return view.sort === "oldest" ? -dates : dates;
    if (view.sort === "favorite" && left.favorite !== right.favorite) {
      return Number(right.favorite) - Number(left.favorite);
    }
    return view.sort === "oldest"
      ? left.createdAtMs - right.createdAtMs
      : right.createdAtMs - left.createdAtMs;
  });
}

export function responsiveHistoryColumnCount(
  selected: number,
  screens: { sm?: boolean; lg?: boolean },
): number {
  const columns = Math.min(10, Math.max(1, Math.round(selected)));
  if (screens.lg) return columns;
  return screens.sm ? Math.min(2, columns) : 1;
}
