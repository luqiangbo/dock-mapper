const PREFERENCES = [
  "theme",
  "accent-color",
  "navigation",
  "sidebar-width",
  "screenshot-history-view",
  "ui-font",
];
export function clearBuildPreferences(
  storage: Pick<Storage, "getItem" | "removeItem" | "setItem">,
  revision: number,
) {
  // Builds and installations never reset preferences. Only a committed user reset does.
  if (!Number.isSafeInteger(revision) || revision <= 0) return;
  const key = "dock-mapper:settings-reset-revision";
  if (storage.getItem(key) === String(revision)) return;
  for (const key of PREFERENCES) storage.removeItem(`dock-mapper:${key}`);
  storage.setItem(key, String(revision));
}
