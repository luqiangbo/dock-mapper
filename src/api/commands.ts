import { invoke } from "@tauri-apps/api/core";
import type { ScreenshotHistorySummary } from "../screenshots/screenshot/api";
import { copyBinaryPayload } from "../screenshots/screenshot/utils/binaryPayload";
import type {
  ApplyScancodeMapResult,
  KeyMapping,
  RuntimeHealth,
  ScancodeMapStatus,
  ScreenshotConfig,
  ShortcutRuntimeStatus,
  SupportedKey,
  WidgetConfig,
} from "../types";

export const MAIN_EVENTS = {
  configChanged: "config-changed",
  historyChanged: "screenshot-history-changed",
  navigate: "navigate-main",
  scancodeMapChanged: "scancode-map-changed",
  systemStatus: "sys-status-update",
  shortcutStatusChanged: "shortcut-status-changed",
} as const;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function invokeBinary(command: string, args: Record<string, unknown>): Promise<ArrayBuffer> {
  return copyBinaryPayload(await invoke<unknown>(command, args));
}

export const keyMappingApi = {
  supportedKeys: () => invoke<SupportedKey[]>("get_supported_keys"),
  mappings: () => invoke<KeyMapping[]>("get_key_mappings"),
  status: () => invoke<ScancodeMapStatus>("get_scancode_map_status"),
  sync: (mappings: KeyMapping[]) => invoke<void>("sync_key_mappings", { mappings }),
  apply: (confirmTakeover: boolean) =>
    invoke<ApplyScancodeMapResult>("apply_scancode_map", { confirmTakeover }),
  restore: () => invoke<ScancodeMapStatus>("restore_scancode_map"),
};

export const historyApi = {
  list: () => invoke<ScreenshotHistorySummary[]>("list_screenshot_history"),
  image: (id: string) => invokeBinary("get_screenshot_history_image", { id }),
  thumbnail: (id: string) => invokeBinary("get_screenshot_history_thumbnail", { id }),
  copy: (id: string) => invoke<boolean>("copy_screenshot_history", { id }),
  pin: (id: string) => invoke<string>("pin_screenshot_history", { id }),
  favorite: (id: string, favorite: boolean) =>
    invoke<ScreenshotHistorySummary>("set_screenshot_history_favorite", { id, favorite }),
  delete: (id: string) => invoke<boolean>("delete_screenshot_history", { id }),
};

export const screenshotSettingsApi = {
  get: () => invoke<ScreenshotConfig>("get_screenshot_config"),
  update: (screenshotConfig: ScreenshotConfig) =>
    invoke<ScreenshotConfig>("update_screenshot_config", { screenshotConfig }),
  shortcutStatuses: () =>
    invoke<ShortcutRuntimeStatus[]>("get_screenshot_shortcut_statuses"),
  resetShortcuts: () => invoke<ScreenshotConfig>("reset_screenshot_shortcuts"),
  chooseSaveDirectory: () => invoke<string | null>("choose_screenshot_save_directory"),
  start: () => invoke<void>("start_screenshot"),
};

export const generalSettingsApi = {
  minimizeToTray: () => invoke<boolean>("get_minimize_to_tray"),
  setMinimizeToTray: (enabled: boolean) =>
    invoke<void>("set_minimize_to_tray", { enabled }),
  exportDiagnostics: () => invoke<string | null>("export_diagnostics"),
};

export const widgetApi = {
  config: () => invoke<WidgetConfig>("get_widget_config"),
  networkInterfaces: () => invoke<string[]>("get_network_interfaces"),
  update: (config: WidgetConfig) => invoke<WidgetConfig>("update_widget_config", { config }),
};

export const runtimeApi = {
  health: () => invoke<RuntimeHealth>("get_runtime_health"),
};
