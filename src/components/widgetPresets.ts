import type { WidgetConfig } from "../types";

export function saveCurrentWidgetPreset(config: WidgetConfig, name: string): WidgetConfig {
  const normalizedName = name.trim().slice(0, 24);
  if (!normalizedName) return config;
  const existing = config.presets.find((preset) => preset.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase());
  if (config.presets.length >= 8 && !existing) return config;
  const preset = {
    name: existing?.name ?? normalizedName,
    metrics: config.metrics.map((metric) => ({ ...metric })),
    refresh_interval_secs: config.refresh_interval_secs,
    speed_unit: config.speed_unit,
  };
  return { ...config, presets: [...config.presets.filter((item) => item.name !== existing?.name), preset] };
}

export function applyWidgetPreset(config: WidgetConfig, name: string): WidgetConfig | null {
  const preset = config.presets.find((item) => item.name === name);
  if (!preset) return null;
  return {
    ...config,
    metrics: preset.metrics.map((metric) => ({ ...metric })),
    refresh_interval_secs: preset.refresh_interval_secs,
    speed_unit: preset.speed_unit,
  };
}

export function deleteWidgetPreset(config: WidgetConfig, name: string): WidgetConfig {
  return { ...config, presets: config.presets.filter((preset) => preset.name !== name) };
}
