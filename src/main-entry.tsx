import React from "react";
import ReactDOM from "react-dom/client";
import { I18nContext, getMessages } from "./screenshots/litesnap/i18n";
import ScreenshotOverlay from "./screenshots/litesnap/components/ScreenshotOverlay";
import PinImage from "./screenshots/litesnap/components/PinImage";
import ScrollCaptureControl from "./screenshots/litesnap/components/ScrollCaptureControl";
import "./screenshots/litesnap/api";

const view = new URLSearchParams(window.location.search).get("view");
const root = ReactDOM.createRoot(document.getElementById("root")!);
const liteSnapView = view === "overlay" || view === "pin" || view === "scroll-capture";

function LiteSnapWindow() {
  const content =
    view === "pin" ? (
      <PinImage />
    ) : view === "scroll-capture" ? (
      <ScrollCaptureControl />
    ) : (
      <ScreenshotOverlay />
    );

  return (
    <I18nContext.Provider value={{ language: "zh", t: getMessages("zh") }}>
      {content}
    </I18nContext.Provider>
  );
}

if (liteSnapView) {
  // LiteSnap windows run in separate WebViews. Loading its reset and canvas
  // styles only here prevents Ant Design/global application styles affecting
  // the transparent overlay and its pointer geometry.
  void import("./screenshots/litesnap/assets/main.css").then(() => {
    root.render(
      <React.StrictMode>
        <LiteSnapWindow />
      </React.StrictMode>,
    );
  });
} else {
  void import("./main-shell").then(({ default: MainShell }) => {
    root.render(
      <React.StrictMode>
        <MainShell />
      </React.StrictMode>,
    );
  });
}
