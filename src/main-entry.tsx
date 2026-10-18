import "./utils/disableBrowserContextMenu";
import React from "react";
import ReactDOM from "react-dom/client";
import MainShell from "./main-shell";
import DefaultsGate from "./DefaultsGate";
import MainWindowBoundary from "./MainWindowBoundary";

const root = ReactDOM.createRoot(document.getElementById("root")!);

root.render(
  <React.StrictMode>
    <MainWindowBoundary>
      <DefaultsGate>
        <MainShell />
      </DefaultsGate>
    </MainWindowBoundary>
  </React.StrictMode>,
);
