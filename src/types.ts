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

export interface EngineStatus {
  running: boolean;
  enabled: boolean;
  last_error: string | null;
}

export interface WidgetConfig {
  memory_scheme: MemoryScheme;
  refresh_interval_secs: number;
}

export interface SysStatus {
  upload_speed: number;
  download_speed: number;
  memory_usage: number;
}
