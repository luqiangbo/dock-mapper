import { copyBinaryPayload } from "../screenshots/screenshot/utils/binaryPayload";
import type { KeyMapping, KeyVisualizerConfig, ScreenshotConfig, WidgetConfig } from "../types";
import { invokeCommand } from "./ipc";
import { logOperation, logRead } from "../components/runtimeLogging";
import { startScreenshot } from "../components/captureStartupRuntime";

export const MAIN_EVENTS = {
  screenshotConfigChanged: "screenshot-config-changed",
  configChanged: "config-changed",
  widgetConfigChanged: "widget-config-changed",
  historyChanged: "screenshot-history-changed",
  historyWriteFailed: "screenshot-history-write-failed",
  navigate: "navigate-main",
  keyMappingChanged: "key-mapping-changed",
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
  supportedKeys: () =>
    logRead("key_mapping", "读取支持按键", () => invokeCommand("get_supported_keys")),
  mappings: () =>
    logRead("key_mapping", "读取运行时映射规则", () => invokeCommand("get_key_mappings")),
  status: () =>
    logRead("key_mapping", "读取映射运行状态", () => invokeCommand("get_key_mapping_status")),
  sync: (mappings: KeyMapping[]) =>
    logOperation("key_mapping", "保存并切换映射规则", () =>
      invokeCommand("sync_key_mappings", { mappings }),
    ),
  enabled: (enabled: boolean) =>
    logOperation("key_mapping", "切换按键映射总开关", () =>
      invokeCommand("set_key_mapping_enabled", { enabled }),
    ),
  legacy: () =>
    logRead("key_mapping", "读取遗留系统映射", () => invokeCommand("get_legacy_key_mappings")),
  clearLegacy: (expectedValue: string | null) =>
    logOperation("key_mapping", "备份并清理遗留系统映射", () =>
      invokeCommand("clear_legacy_key_mappings", { expectedValue }),
    ),
};

export const historyApi = {
  openPreview: (id: string, ids?: string[]) =>
    logOperation("history", "打开原图预览", () =>
      invokeCommand("open_screenshot_history_preview", { id, ids }),
    ),
  navigatePreview: (generation: number, direction: -1 | 1) =>
    invokeCommand("navigate_screenshot_history_preview", { generation, direction }),
  previewSession: () => invokeCommand("get_screenshot_history_preview_session"),
  list: () => logRead("history", "读取截图历史", () => invokeCommand("list_screenshot_history")),
  image: async (id: string) =>
    copyBinaryPayload(await invokeCommand("get_screenshot_history_image", { id })),
  thumbnail: async (id: string) =>
    copyBinaryPayload(await invokeCommand("get_screenshot_history_thumbnail", { id })),
  copy: (id: string) =>
    logOperation("history", "复制历史截图", () => invokeCommand("copy_screenshot_history", { id })),
  pin: (id: string) =>
    logOperation("history", "贴出历史截图", () => invokeCommand("pin_screenshot_history", { id })),
  favorite: (id: string, favorite: boolean) =>
    logOperation("history", "修改历史收藏", () =>
      invokeCommand("set_screenshot_history_favorite", { id, favorite }),
    ),
  delete: (id: string) =>
    logOperation("history", "删除历史截图", () =>
      invokeCommand("delete_screenshot_history", { id }),
    ),
};

export const screenshotSettingsApi = {
  get: () => logRead("settings", "读取截图设置", () => invokeCommand("get_screenshot_config")),
  update: (screenshotConfig: ScreenshotConfig) =>
    logOperation("settings", "保存截图设置", () =>
      invokeCommand("update_screenshot_config", { screenshotConfig }),
    ),
  shortcutStatuses: () => invokeCommand("get_screenshot_shortcut_statuses"),
  resetShortcuts: () =>
    logOperation("settings", "重置截图快捷键", () => invokeCommand("reset_screenshot_shortcuts")),
  chooseSaveDirectory: () => invokeCommand("choose_screenshot_save_directory"),
  start: () => logOperation("screenshot", "请求启动截图", startScreenshot),
  startQuickOcr: () => logOperation("ocr", "启动快速 OCR", () => invokeCommand("start_quick_ocr")),
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
  setMinimizeToTray: (enabled: boolean) =>
    logOperation("settings", "修改托盘设置", () =>
      invokeCommand("set_minimize_to_tray", { enabled }),
    ),
  exportDiagnostics: () => invokeCommand("export_diagnostics"),
};

export const widgetApi = {
  config: () => logRead("settings", "读取挂件设置", () => invokeCommand("get_widget_config")),
  update: (config: WidgetConfig) =>
    logOperation("settings", "保存挂件设置", () =>
      invokeCommand("update_widget_config", { config }),
    ),
};

export const keyVisualizerApi = {
  ready: (generation: number) => invokeCommand("key_visualizer_ready", { generation }),
  session: () => invokeCommand("get_key_visualizer_session"),
  config: () => invokeCommand("get_key_visualizer_config"),
  update: (keyVisualizerConfig: KeyVisualizerConfig) =>
    logOperation("settings", "保存按键展示设置", () =>
      invokeCommand("update_key_visualizer_config", { keyVisualizerConfig }),
    ),
  status: () => invokeCommand("get_key_visualizer_status"),
  retry: () => invokeCommand("retry_key_visualizer"),
  effectsStatus: () => invokeCommand("get_key_visualizer_effects_status"),
  locate: () => invokeCommand("locate_key_visualizer_mouse"),
  effectsReady: () => invokeCommand("key_visualizer_effects_ready"),
};

export const runtimeApi = {
  health: () => invokeCommand("get_runtime_health"),
};
