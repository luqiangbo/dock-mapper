const PREFERENCES = [
  "theme",
  "accent-color",
  "navigation",
  "sidebar-width",
  "screenshot-history-view",
];
export function clearBuildPreferences(
  storage: Pick<Storage, "getItem" | "removeItem" | "setItem">,
  identity: string,
) {
  if (storage.getItem("dock-mapper:defaults-build-id") === identity) return;
  for (const key of PREFERENCES) storage.removeItem(`dock-mapper:${key}`);
  storage.setItem("dock-mapper:defaults-build-id", identity);
}
