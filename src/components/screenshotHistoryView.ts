import type { ScreenshotHistorySummary } from "../screenshots/screenshot/api";

export const SCREENSHOT_HISTORY_VIEW_KEY = "dock-mapper:screenshot-history-view";

export type HistorySort = "newest" | "oldest" | "favorite";
export type HistoryFilter = "all" | "favorite";
export type HistoryDensity = "compact" | "standard" | "large";

export interface ScreenshotHistoryView {
  sort: HistorySort;
  filter: HistoryFilter;
  density: HistoryDensity;
}

export const DEFAULT_SCREENSHOT_HISTORY_VIEW: ScreenshotHistoryView = {
  sort: "newest",
  filter: "all",
  density: "standard",
};

const SORT_VALUES: readonly HistorySort[] = ["newest", "oldest", "favorite"];
const FILTER_VALUES: readonly HistoryFilter[] = ["all", "favorite"];
const DENSITY_VALUES: readonly HistoryDensity[] = ["compact", "standard", "large"];

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
      density: isAllowed(parsed.density, DENSITY_VALUES)
        ? parsed.density
        : DEFAULT_SCREENSHOT_HISTORY_VIEW.density,
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
