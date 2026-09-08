import type { ScreenshotHistorySummary } from "../screenshots/screenshot/api";

export const SCREENSHOT_HISTORY_VIEW_KEY = "dock-mapper:screenshot-history-view";

export type HistorySort = "newest" | "oldest" | "favorite";
export type HistoryFilter = "all" | "favorite";

export interface ScreenshotHistoryView {
  sort: HistorySort;
  filter: HistoryFilter;
  columns: number;
}

export const DEFAULT_SCREENSHOT_HISTORY_VIEW: ScreenshotHistoryView = {
  sort: "newest",
  filter: "all",
  columns: 3,
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
    return {
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
          : LEGACY_DENSITY_COLUMNS[String(parsed.density)] ??
            DEFAULT_SCREENSHOT_HISTORY_VIEW.columns,
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
  try {
    window.localStorage.setItem(SCREENSHOT_HISTORY_VIEW_KEY, JSON.stringify(view));
  } catch {
    // Viewing preferences are optional; storage failures must not block history.
  }
}

export function selectScreenshotHistory(
  entries: ScreenshotHistorySummary[],
  view: ScreenshotHistoryView,
): ScreenshotHistorySummary[] {
  const filtered =
    view.filter === "favorite" ? entries.filter((entry) => entry.favorite) : [...entries];
  return filtered.sort((left, right) => {
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
