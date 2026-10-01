import React, { useLayoutEffect } from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, theme as antdTheme } from "antd";
import ScreenshotOverlay from "./screenshots/screenshot/components/ScreenshotOverlay";
import { I18nContext, getMessages } from "./screenshots/screenshot/i18n";
import "@excalidraw/excalidraw/index.css";
import "./screenshots/screenshot/api";
import "./screenshots/screenshot/assets/main.css";
import { useWindowTheme } from "./hooks/useWindowTheme";
import { accentColors, themePalettes } from "./themePalette";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
  }
}

// The packaged fonts are copied to dist/excalidraw/fonts by Rsbuild. Never
// allow the capture window to fetch editor resources from a public CDN.
window.EXCALIDRAW_ASSET_PATH = "/excalidraw/";

const root = ReactDOM.createRoot(document.getElementById("root")!);

function ScreenshotWindow() {
  const { accentColor, resolved } = useWindowTheme();
  const colors = accentColors(accentColor, "dark");
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.colorScheme = "dark";
    root.style.setProperty("--screenshot-accent", colors.solid);
    root.style.setProperty("--screenshot-accent-strong", colors.solid);
    root.style.setProperty("--screenshot-accent-ink", colors.foreground);
    root.style.setProperty("--screenshot-accent-soft", colors.soft);
  }, [colors.solid, colors.foreground, colors.soft, resolved]);
  return (
    <ConfigProvider
      getPopupContainer={() => document.getElementById("root") ?? document.body}
      theme={{
        algorithm: [antdTheme.darkAlgorithm, antdTheme.compactAlgorithm],
        token: {
          colorPrimary: colors.solid,
          colorInfo: colors.solid,
          colorLink: colors.foreground,
          colorBgElevated: themePalettes.dark["surface-base"],
          controlHeight: 32,
          controlHeightSM: 30,
          borderRadius: 6,
          fontSize: 14,
          fontWeightStrong: 600,
          zIndexPopupBase: 100,
        },
      }}
    >
      <I18nContext.Provider value={{ language: "zh", t: getMessages("zh") }}>
        <ScreenshotOverlay />
      </I18nContext.Provider>
    </ConfigProvider>
  );
}

root.render(
  <React.StrictMode>
    <ScreenshotWindow />
  </React.StrictMode>,
);
