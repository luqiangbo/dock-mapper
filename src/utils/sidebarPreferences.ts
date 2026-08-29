export const SIDEBAR_WIDTH_KEY = "dock-mapper:sidebar-width";
export const SIDEBAR_MIN_WIDTH = 168;
export const SIDEBAR_MAX_WIDTH = 320;
export const SIDEBAR_DEFAULT_WIDTH = 208;

export function parseSidebarWidth(value: string | null): number {
  if (value === null) return SIDEBAR_DEFAULT_WIDTH;
  const width = Number(value);
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

export function loadSidebarWidth(): number {
  try {
    return parseSidebarWidth(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

export function saveSidebarWidth(width: number): void {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(parseSidebarWidth(String(width))));
  } catch {
    // Sidebar persistence is optional and must never block the main window.
  }
}
