export type KeyCode = string & { readonly __keyCode: unique symbol };
export type MemoryScheme = "capsule" | "ring" | "gauge";
export type ThemeMode = "light" | "dark" | "system";

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
  applied: boolean;
  has_external_map: boolean;
  requires_restart: boolean;
  backup_available: boolean;
}

export interface ScreenshotConfig {
  shortcut: string;
  pin_shortcut: string;
  save_directory: string | null;
  filename_prefix: string;
  color_copy_format: "hex" | "rgb" | "hsl" | "hsv" | "css";
}

export interface WidgetConfig {
  memory_scheme: MemoryScheme;
  refresh_interval_secs: number;
  network_interface: string | null;
}

export interface SysStatus {
  upload_speed: number;
  download_speed: number;
  memory_usage: number;
}
