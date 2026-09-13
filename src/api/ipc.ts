import { invoke } from "@tauri-apps/api/core";
import ipcContract from "../../ipc-contract.json";
import { IPC_COMMAND_NAMES } from "./ipcCommandNames";
import type {
  ApplyScancodeMapResult,
  AnnotationOutlineConfig,
  ScreenshotAnnotationStyles,
  ColorPaletteConfig,
  KeyMapping,
  KeyVisualizerConfig,
  KeyVisualizerEffectsStatus,
  KeyVisualizerSession,
  KeyVisualizerStatus,
  RuntimeHealth,
  ScancodeMapStatus,
  ScreenshotConfig,
  ShortcutRuntimeStatus,
  SupportedKey,
  WidgetConfig,
} from "../types";
import type {
  FullScreenshot,
  CaptureSelectionTrace,
  OcrResult,
  PinOptions,
  PinWindowGeometry,
  PinWindowGeometryRequest,
  QrDecodeResult,
  ScreenshotHistorySummary,
  WidgetLayoutBudget,
} from "./screenshotTypes";

interface CommandContract {
  get_supported_keys: { args: undefined; result: SupportedKey[] };
  get_key_mappings: { args: undefined; result: KeyMapping[] };
  get_scancode_map_status: { args: undefined; result: ScancodeMapStatus };
  sync_key_mappings: { args: { mappings: KeyMapping[] }; result: void };
  apply_scancode_map: { args: { confirmTakeover: boolean }; result: ApplyScancodeMapResult };
  restore_scancode_map: { args: undefined; result: ScancodeMapStatus };
  list_screenshot_history: { args: undefined; result: ScreenshotHistorySummary[] };
  get_screenshot_history_image: { args: { id: string }; result: unknown };
  get_screenshot_history_thumbnail: { args: { id: string }; result: unknown };
  create_screenshot_history: { args: { resultImageId: string }; result: ScreenshotHistorySummary };
  set_screenshot_history_favorite: {
    args: { id: string; favorite: boolean };
    result: ScreenshotHistorySummary;
  };
  delete_screenshot_history: { args: { id: string }; result: boolean };
  copy_screenshot_history: { args: { id: string }; result: boolean };
  pin_screenshot_history: { args: { id: string }; result: string };
  get_screenshot_config: { args: undefined; result: ScreenshotConfig };
  update_screenshot_config: {
    args: { screenshotConfig: ScreenshotConfig };
    result: ScreenshotConfig;
  };
  update_screenshot_annotation_color: { args: { color: string }; result: string };
  update_screenshot_annotation_outline: {
    args: { outline: AnnotationOutlineConfig };
    result: AnnotationOutlineConfig;
  };
  update_screenshot_annotation_styles: {
    args: { styles: ScreenshotAnnotationStyles };
    result: ScreenshotAnnotationStyles;
  };
  get_screenshot_shortcut_statuses: { args: undefined; result: ShortcutRuntimeStatus[] };
  reset_screenshot_shortcuts: { args: undefined; result: ScreenshotConfig };
  choose_screenshot_save_directory: { args: undefined; result: string | null };
  start_screenshot: { args: undefined; result: void };
  start_quick_ocr: { args: undefined; result: void };
  get_color_palette: { args: undefined; result: ColorPaletteConfig };
  record_palette_color: { args: { color: string }; result: ColorPaletteConfig };
  set_palette_favorite: {
    args: { color: string; favorite: boolean };
    result: ColorPaletteConfig;
  };
  clear_recent_palette: { args: undefined; result: ColorPaletteConfig };
  get_minimize_to_tray: { args: undefined; result: boolean };
  set_minimize_to_tray: { args: { enabled: boolean }; result: void };
  export_diagnostics: { args: undefined; result: string | null };
  get_widget_config: { args: undefined; result: WidgetConfig };
  update_widget_config: { args: { config: WidgetConfig }; result: WidgetConfig };
  sync_widget_dynamic_width: {
    args: { preferredWidth: number; minimumWidth: number };
    result: WidgetLayoutBudget;
  };
  refresh_widget_position: { args: undefined; result: WidgetLayoutBudget };
  key_visualizer_ready: { args: { generation: number }; result: void };
  get_key_visualizer_session: { args: undefined; result: KeyVisualizerSession };
  get_key_visualizer_config: { args: undefined; result: KeyVisualizerConfig };
  update_key_visualizer_config: {
    args: { keyVisualizerConfig: KeyVisualizerConfig };
    result: KeyVisualizerConfig;
  };
  get_key_visualizer_status: { args: undefined; result: KeyVisualizerStatus };
  retry_key_visualizer: { args: undefined; result: KeyVisualizerStatus };
  get_key_visualizer_effects_status: { args: undefined; result: KeyVisualizerEffectsStatus };
  locate_key_visualizer_mouse: { args: undefined; result: void };
  key_visualizer_effects_ready: { args: undefined; result: KeyVisualizerEffectsStatus };
  get_runtime_health: { args: undefined; result: RuntimeHealth };
  close_overlay: { args: undefined; result: void };
  show_capture_overlay: { args: { generation?: number }; result: boolean };
  overlay_ready: { args: { label: string }; result: void };
  get_full_screenshot: { args: { label: string }; result: FullScreenshot };
  report_capture_rendered: {
    args: { generation: number; label: string; trace?: CaptureSelectionTrace };
    result: boolean;
  };
  check_screen_permission: { args: undefined; result: { granted: boolean; status: string } };
  upload_image: { args: Uint8Array; result: string };
  release_image: { args: { imageId: string }; result: void };
  copy_image: { args: { imageId: string }; result: boolean };
  copy_text: { args: { value: string }; result: boolean };
  save_image: { args: { imageId: string }; result: boolean };
  pin_image: { args: { imageId: string }; result: string };
  recognize_selection: { args: { imageId: string }; result: OcrResult };
  decode_qr_selection: { args: { imageId: string }; result: QrDecodeResult };
  open_url: { args: { url: string }; result: boolean };
  get_pin_image: { args: { id: string }; result: unknown };
  pin_image_ready: { args: { id: string }; result: boolean };
  get_pin_options: { args: { id: string }; result: PinOptions };
  update_pin_options: {
    args: { id: string; opacity: number; locked: boolean };
    result: PinOptions;
  };
  copy_pin_image: { args: { id: string }; result: boolean };
  save_pin_image: { args: { id: string }; result: boolean };
  close_pin_window: { args: { id: string }; result: void };
  get_pin_window_geometry: { args: { id: string }; result: PinWindowGeometry };
  set_pin_window_geometry: {
    args: { id: string; request: PinWindowGeometryRequest };
    result: PinWindowGeometry;
  };
}

export type CommandName = keyof CommandContract;
export type PinActionCommand = "copy_pin_image" | "save_pin_image" | "close_pin_window";

const declaredCommands = new Set<string>(ipcContract.commands);

if (
  declaredCommands.size !== IPC_COMMAND_NAMES.length ||
  IPC_COMMAND_NAMES.some((command) => !declaredCommands.has(command))
) {
  throw new Error("IPC 共享契约与 TypeScript 命令表不一致");
}

export const IPC_CONTRACT_VERSION = ipcContract.version;

export function invokeCommand<Name extends CommandName>(
  command: Name,
  ...args: CommandContract[Name]["args"] extends undefined ? [] : [CommandContract[Name]["args"]]
): Promise<CommandContract[Name]["result"]> {
  if (!declaredCommands.has(command)) {
    return Promise.reject(new Error(`IPC 命令未在共享契约中声明：${command}`));
  }
  return invoke(command, args[0]);
}
