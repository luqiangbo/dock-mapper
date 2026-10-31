import { useEffect, useLayoutEffect, useRef } from "react";
import { App as AntApp } from "antd";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useTheme } from "../ThemeContext";
import { windowResizeActivity } from "../windowResizeActivity";

export async function toggleMainWindowMaximize() {
  windowResizeActivity.begin();
  try {
    await getCurrentWindow().toggleMaximize();
  } catch (error) {
    windowResizeActivity.finish();
    throw error;
  }
}

/** Main-window-only appearance. Transparent capture and widget windows opt out. */
export default function MainWindowPresentation() {
  const { resolved, mode } = useTheme();
  const { notification } = AntApp.useApp();
  const nativeWrites = useRef(Promise.resolve());
  const background = resolved === "dark" ? "#202328" : "#f3f5f7";
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.mainWindow = "true";
    root.style.setProperty("--main-window-surface", background);
    return () => {
      delete root.dataset.mainWindow;
      root.style.removeProperty("--main-window-surface");
    };
  }, [background]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      if (windowResizeActivity.getSnapshot()) root.dataset.windowResizing = "true";
      else delete root.dataset.windowResizing;
    };
    const resize = () => windowResizeActivity.begin();
    const off = windowResizeActivity.subscribe(sync);
    window.addEventListener("resize", resize, { passive: true });
    sync();
    return () => {
      window.removeEventListener("resize", resize);
      off();
      windowResizeActivity.finish();
      delete root.dataset.windowResizing;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    // Serialize rapid theme changes; an older native write cannot finish last.
    nativeWrites.current = nativeWrites.current.then(async () => {
      if (cancelled) return;
      try {
        const window = getCurrentWebviewWindow();
        await window.setTheme(mode === "system" ? null : resolved);
        if (!cancelled) await window.setBackgroundColor(background);
      } catch (error) {
        if (!cancelled)
          notification.error({
            key: "native-window-appearance",
            message: "窗口主题同步失败",
            description: String(error),
          });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [background, mode, resolved, notification]);
  return null;
}
