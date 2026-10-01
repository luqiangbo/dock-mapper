import React from "react";
import ReactDOM from "react-dom/client";
import "./global.scss";
import HistoryPreview from "./history-preview/HistoryPreview";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HistoryPreview />
  </React.StrictMode>,
);
