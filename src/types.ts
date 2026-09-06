export type KeyCode = string & { readonly __keyCode: unique symbol };
export type MemoryScheme = "capsule" | "ring" | "gauge";
export type UsageScheme = MemoryScheme;
export type SpeedUnit = "auto" | "kb" | "mb";
export type WidgetMetricKind = "network" | "cpu" | "memory" | "battery";
export type ThemeMode = "light" | "dark" | "system";
export type KeyVisualizerCategory = "modifier" | "combination" | "character" | "other";

export interface KeyMapping {
  id: string;
  source_key: KeyCode;
  target_key: KeyCode;
  enabled: boolean;
}

export interface SupportedKey {
  code: KeyCode;
  label: string;
  group: string;
}

export interface ScancodeMapStatus {
  state: "not_applied" | "applied" | "draft_changed" | "system_changed";
  backup_available: boolean;
}

export interface ApplyScancodeMapResult {
  outcome: "applied" | "confirmationRequired";
  status: ScancodeMapStatus;
}

export interface ScreenshotConfig {
  shortcut: string;
  pin_shortcut: string;
  history_shortcut: string;
  toggle_pin_shortcut: string;
  quick_ocr_shortcut: string;
  save_directory: string | null;
  filename_prefix: string;
  color_copy_format: "hex" | "rgb" | "hsl" | "hsv" | "css";
  capture_size_unit: "px" | "dip";
}

export interface WidgetConfig {
  memory_scheme: MemoryScheme;
  metrics: WidgetMetricConfig[];
  refresh_interval_secs: number;
  network_interface: string | null;
  speed_unit: SpeedUnit;
}

export interface WidgetMetricConfig {
  kind: WidgetMetricKind;
  enabled: boolean;
  usage_scheme: UsageScheme;
}

export interface ColorPaletteConfig {
  recent: string[];
  favorites: string[];
}

export interface KeyVisualizerConfig {
  enabled: boolean;
  show_modifiers: boolean;
  show_combinations: boolean;
  show_characters: boolean;
  show_other: boolean;
  font_size: number;
  scale_percent: number;
  text_opacity: number;
}

export interface KeyVisualizerStatus {
  listening: boolean;
  error: string | null;
}

export interface KeyVisualizerInput {
  generation: number;
  label: string;
  category: KeyVisualizerCategory;
  repeat: number;
  timestamp_ms: number;
}

export interface KeyVisualizerSession {
  config: KeyVisualizerConfig;
  generation: number;
}

export interface PresentationConfig {
  keyboard: boolean;
  clicks: boolean;
  highlight: boolean;
  lock_keys: boolean;
  show_characters: boolean;
  show_modifiers: boolean;
  toggle_shortcut: string;
  locate_shortcut: string;
}

export interface PresentationScreen {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export interface PresentationStatus {
  enabled: boolean;
  suspended: boolean;
  generation: number;
  phase: "off" | "starting" | "running";
  error: string | null;
  shortcut_error: string | null;
  config: PresentationConfig;
  screens: PresentationScreen[];
  locks: PresentationLocks | null;
}

export interface PresentationMouse {
  generation: number;
  x: number;
  y: number;
  kind: "move" | "left" | "right" | "middle" | "locate";
  timestamp_ms: number;
}

export interface PresentationLocks {
  generation: number;
  caps: boolean;
  num: boolean;
  timestamp_ms: number;
}

export interface SysStatus {
  upload_speed: number;
  download_speed: number;
  memory_usage: number;
  network_available: boolean;
  cpu_usage?: number;
  battery?: { percentage: number; charging: boolean } | null;
}

export interface RuntimeHealth {
  screenshot: {
    shortcuts: ShortcutRuntimeStatus[];
    recentCaptureBackend: string | null;
    recentCaptureMs: number | null;
    captureP95Ms: number | null;
    dxgiFallbackCount: number;
    pinCount: number;
  };
  historyCount: number;
  transientImageCount: number;
  transientImageBytes: number;
}

export interface ShortcutRuntimeStatus {
  actionId: "capture" | "pin_recent" | "open_history" | "toggle_latest_pin" | "quick_ocr";
  action: string;
  shortcut: string;
  registered: boolean;
  error: string | null;
}
