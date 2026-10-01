export type PageKey =
  | "dashboard"
  | "keymapper"
  | "keyvisualizer"
  | "screenshot"
  | "widget"
  | "settings";
export type ScreenshotTabKey = "history" | "settings";
export interface MainNavigation {
  page: PageKey;
  tab?: ScreenshotTabKey;
}
export interface NavigationPreferences {
  page: PageKey;
  tab: ScreenshotTabKey;
}
const KEY = "dock-mapper:navigation";
const PAGES: readonly string[] = [
  "dashboard",
  "keymapper",
  "keyvisualizer",
  "screenshot",
  "widget",
  "settings",
];
export function parseNavigationPreferences(raw: string | null): NavigationPreferences {
  const fallback: NavigationPreferences = { page: "dashboard", tab: "history" };
  try {
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    if (!value || !PAGES.includes(value.page) || !["history", "settings"].includes(value.tab))
      return fallback;
    return { page: value.page, tab: value.tab };
  } catch {
    return fallback;
  }
}
export function loadNavigationPreferences(): NavigationPreferences {
  try {
    return parseNavigationPreferences(window.localStorage.getItem(KEY));
  } catch {
    return parseNavigationPreferences(null);
  }
}
export function saveNavigationPreferences(value: NavigationPreferences): void {
  window.localStorage.setItem(KEY, JSON.stringify(value));
}
export function isMainNavigation(value: MainNavigation): boolean {
  return (
    !!value &&
    PAGES.includes(value.page) &&
    (value.tab === undefined || value.tab === "history" || value.tab === "settings")
  );
}
