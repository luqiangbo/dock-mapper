import { copyBinaryPayload } from "../screenshots/screenshot/utils/binaryPayload";
import type { KeyMapping, KeyVisualizerConfig, ScreenshotConfig, WidgetConfig } from "../types";
import { invokeCommand } from "./ipc";

export const MAIN_EVENTS = {
  configChanged: "config-changed",
  historyChanged: "screenshot-history-changed",
  navigate: "navigate-main",
  scancodeMapChanged: "scancode-map-changed",
  systemStatus: "sys-status-update",
  shortcutStatusChanged: "shortcut-status-changed",
  keyVisualizerConfigChanged: "key-visualizer-config-changed",
  keyVisualizerInput: "key-visualizer-input",
  keyVisualizerSession: "key-visualizer-session",
  keyVisualizerEffectsStatus: "key-visualizer-effects-status",
  keyVisualizerMouse: "key-visualizer-mouse",
  keyVisualizerLocks: "key-visualizer-locks",
} as const;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const keyMappingApi = {
  supportedKeys: () => invokeCommand("get_supported_keys"),
  mappings: () => invokeCommand("get_key_mappings"),
  status: () => invokeCommand("get_scancode_map_status"),
  sync: (mappings: KeyMapping[]) => invokeCommand("sync_key_mappings", { mappings }),
  apply: (confirmTakeover: boolean) => invokeCommand("apply_scancode_map", { confirmTakeover }),
  restore: () => invokeCommand("restore_scancode_map"),
};

export const historyApi = {
  list: () => invokeCommand("list_screenshot_history"),
  image: async (id: string) =>
    copyBinaryPayload(await invokeCommand("get_screenshot_history_image", { id })),
  thumbnail: async (id: string) =>
    copyBinaryPayload(await invokeCommand("get_screenshot_history_thumbnail", { id })),
  copy: (id: string) => invokeCommand("copy_screenshot_history", { id }),
  pin: (id: string) => invokeCommand("pin_screenshot_history", { id }),
  favorite: (id: string, favorite: boolean) =>
    invokeCommand("set_screenshot_history_favorite", { id, favorite }),
  delete: (id: string) => invokeCommand("delete_screenshot_history", { id }),
};

export const screenshotSettingsApi = {
  get: () => invokeCommand("get_screenshot_config"),
  update: (screenshotConfig: ScreenshotConfig) =>
    invokeCommand("update_screenshot_config", { screenshotConfig }),
  shortcutStatuses: () => invokeCommand("get_screenshot_shortcut_statuses"),
  resetShortcuts: () => invokeCommand("reset_screenshot_shortcuts"),
  chooseSaveDirectory: () => invokeCommand("choose_screenshot_save_directory"),
  start: () => invokeCommand("start_screenshot"),
  startQuickOcr: () => invokeCommand("start_quick_ocr"),
};

export const paletteApi = {
  get: () => invokeCommand("get_color_palette"),
  record: (color: string) => invokeCommand("record_palette_color", { color }),
  favorite: (color: string, favorite: boolean) =>
    invokeCommand("set_palette_favorite", { color, favorite }),
  clearRecent: () => invokeCommand("clear_recent_palette"),
};

export const generalSettingsApi = {
  minimizeToTray: () => invokeCommand("get_minimize_to_tray"),
  setMinimizeToTray: (enabled: boolean) => invokeCommand("set_minimize_to_tray", { enabled }),
  exportDiagnostics: () => invokeCommand("export_diagnostics"),
};

export const widgetApi = {
  config: () => invokeCommand("get_widget_config"),
  update: (config: WidgetConfig) => invokeCommand("update_widget_config", { config }),
};

export const keyVisualizerApi = {
  ready: (generation: number) => invokeCommand("key_visualizer_ready", { generation }),
  session: () => invokeCommand("get_key_visualizer_session"),
  config: () => invokeCommand("get_key_visualizer_config"),
  update: (keyVisualizerConfig: KeyVisualizerConfig) =>
    invokeCommand("update_key_visualizer_config", { keyVisualizerConfig }),
  status: () => invokeCommand("get_key_visualizer_status"),
  retry: () => invokeCommand("retry_key_visualizer"),
  effectsStatus: () => invokeCommand("get_key_visualizer_effects_status"),
  locate: () => invokeCommand("locate_key_visualizer_mouse"),
  effectsReady: () => invokeCommand("key_visualizer_effects_ready"),
};

export const runtimeApi = {
  health: () => invokeCommand("get_runtime_health"),
};
