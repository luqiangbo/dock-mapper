import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, theme as antdTheme } from "antd";
import ScreenshotOverlay from "./screenshots/litesnap/components/ScreenshotOverlay";
import PinImage from "./screenshots/litesnap/components/PinImage";
import { I18nContext, getMessages } from "./screenshots/litesnap/i18n";
import "./screenshots/litesnap/api";
import "./screenshots/litesnap/assets/main.css";

const view = new URLSearchParams(window.location.search).get("view");
const root = ReactDOM.createRoot(document.getElementById("root")!);

function LiteSnapWindow() {
  const content = view === "pin" ? <PinImage /> : <ScreenshotOverlay />;

  return (
    <ConfigProvider
      getPopupContainer={() => document.getElementById("root") ?? document.body}
      theme={{
        algorithm: [antdTheme.darkAlgorithm, antdTheme.compactAlgorithm],
        token: {
          colorPrimary: "#6366f1",
          colorBgElevated: "#181a26",
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
        {content}
      </I18nContext.Provider>
    </ConfigProvider>
  );
}

root.render(
  <React.StrictMode>
    <LiteSnapWindow />
  </React.StrictMode>,
);
