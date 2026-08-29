import type { ScreenshotConfig, ShortcutRuntimeStatus } from "../types";

export interface ShortcutStatusDisplay {
  label: "检测中" | "已注册" | "冲突";
  color?: "success" | "error";
  detail: string | null;
}

export function shortcutStatusDisplay(
  status: ShortcutRuntimeStatus | undefined,
): ShortcutStatusDisplay {
  if (!status) return { label: "检测中", detail: null };
  if (status.registered) return { label: "已注册", color: "success", detail: null };
  return {
    label: "冲突",
    color: "error",
    detail: status.error || "快捷键未能注册",
  };
}

export async function resetShortcutConfig(
  current: ScreenshotConfig,
  request: () => Promise<ScreenshotConfig>,
): Promise<{ config: ScreenshotConfig; error: unknown | null }> {
  try {
    return { config: await request(), error: null };
  } catch (error) {
    return { config: current, error };
  }
}
