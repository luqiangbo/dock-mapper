import React from "react";
import ReactDOM from "react-dom/client";
import ScreenshotOverlay from "./screenshots/litesnap/components/ScreenshotOverlay";
import PinImage from "./screenshots/litesnap/components/PinImage";
import ScrollCaptureControl from "./screenshots/litesnap/components/ScrollCaptureControl";
import { I18nContext, getMessages } from "./screenshots/litesnap/i18n";
import "./screenshots/litesnap/api";
import "./screenshots/litesnap/assets/main.css";

const view = new URLSearchParams(window.location.search).get("view");
const root = ReactDOM.createRoot(document.getElementById("root")!);

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

root.render(
  <React.StrictMode>
    <LiteSnapWindow />
  </React.StrictMode>,
);
