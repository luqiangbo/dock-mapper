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
  annotation_color: string;
  annotation_outline: AnnotationOutlineConfig;
  annotation_styles: ScreenshotAnnotationStyles;
  /** Internal migration marker round-tripped by settings updates. */
  _annotation_styles_initialized?: boolean;
  capture_size_unit: "px" | "dip";
}

export type AnnotationStrokeStyle = "solid" | "dashed" | "dotted";
export type AnnotationFillStyle = "none" | "solid" | "hachure" | "cross_hatch" | "zigzag";
export type AnnotationArrowType = "sharp" | "round" | "elbow";
export type AnnotationArrowhead = "none" | "arrow" | "triangle" | "triangle_outline" | "circle" | "circle_outline" | "dot" | "diamond" | "diamond_outline" | "bar" | "crowfoot_one" | "crowfoot_many" | "crowfoot_one_or_many";

/**
 * One persisted tool preset. Fields that are not meaningful for a given tool
 * are retained so the native config has one forward-compatible wire shape.
 */
export interface AnnotationToolStyleConfig {
  stroke_color: string;
  background_color: string;
  stroke_width: number;
  stroke_style: AnnotationStrokeStyle;
  fill_style: AnnotationFillStyle;
  roughness: 0 | 1 | 2;
  opacity: number;
  arrow_type: AnnotationArrowType;
  start_arrowhead: AnnotationArrowhead;
  end_arrowhead: AnnotationArrowhead;
  pressure: boolean;
  block_size: number;
  font_size: number;
  marker_size: number;
  outline_enabled: boolean;
  outline_color: string;
  outline_width: number;
}

export interface ScreenshotAnnotationStyles {
  shape: AnnotationToolStyleConfig;
  line: AnnotationToolStyleConfig;
  arrow: AnnotationToolStyleConfig;
  pen: AnnotationToolStyleConfig;
  highlight: AnnotationToolStyleConfig;
  text: AnnotationToolStyleConfig;
  number: AnnotationToolStyleConfig;
  mosaic: AnnotationToolStyleConfig;
}

export interface AnnotationOutlineConfig {
  enabled: boolean;
  color: string;
  width: number;
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
  clicks: boolean;
  highlight: boolean;
  lock_keys: boolean;
  font_size: number;
  scale_percent: number;
  text_opacity: number;
}

export interface KeyVisualizerStatus {
  enabled: boolean;
  suspended: boolean;
  generation: number;
  phase: "off" | "starting" | "running";
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

export interface KeyVisualizerScreen {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export interface KeyVisualizerEffectsStatus {
  enabled: boolean;
  suspended: boolean;
  generation: number;
  phase: "off" | "starting" | "running";
  error: string | null;
  config: KeyVisualizerConfig;
  screens: KeyVisualizerScreen[];
  locks: KeyVisualizerLocks | null;
}

export interface KeyVisualizerMouse {
  generation: number;
  x: number;
  y: number;
  kind: "move" | "left" | "right" | "middle" | "locate";
  timestamp_ms: number;
}

export interface KeyVisualizerLocks {
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
