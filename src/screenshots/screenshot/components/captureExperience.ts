import type { Selection } from "../hooks/useCaptureLifecycle";
export interface CaptureRegion extends Selection {
  screen: string;
  physical?: boolean;
}
export interface CaptureExperience {
  hide_main_window: boolean;
  number_start: number;
  number_appearance: import("./annotationTypes").NumberAppearance;
  number_palette: import("./annotationTypes").NumberPalette;
  number_format: "decimal" | "alpha" | "roman";
  number_renumber: boolean;
  number_comment: string;
  presets: Array<{ name: string; region: CaptureRegion | null; delay_ms: number }>;
  restore_pins: boolean;
  pin_history_limit: number;
  detection: "elements" | "windows" | "manual";
  grid: boolean;
  zoom: number;
  hints: boolean;
  guides: boolean;
  remember_tool: boolean;
  shared_color: boolean;
  last_tool: string;
  region_limit: number;
  regions: CaptureRegion[];
  radius: number;
  border: number;
  shadow: number;
}
export const DEFAULT_CAPTURE_EXPERIENCE: CaptureExperience = {
  hide_main_window: true,
  number_start: 1,
  number_appearance: "flat",
  number_palette: "custom",
  number_format: "decimal",
  number_renumber: true,
  number_comment: "",
  presets: [],
  restore_pins: true,
  pin_history_limit: 20,
  detection: "elements",
  grid: true,
  zoom: 8,
  hints: true,
  guides: false,
  remember_tool: false,
  shared_color: true,
  last_tool: "select",
  region_limit: 10,
  regions: [],
  radius: 0,
  border: 0,
  shadow: 0,
};
export function rememberRegion(regions: CaptureRegion[], next: CaptureRegion, limit: number) {
  return [
    next,
    ...regions.filter(
      (item) =>
        item.screen !== next.screen ||
        item.x !== next.x ||
        item.y !== next.y ||
        item.width !== next.width ||
        item.height !== next.height,
    ),
  ].slice(0, Math.max(0, Math.min(100, limit)));
}
