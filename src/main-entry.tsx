import { loadView } from "./utils/loadView";
import "./utils/disableBrowserContextMenu";
import React from "react";
import ReactDOM from "react-dom/client";
import StartupFeedback from "./StartupFeedback";
import { recordRuntimeLog } from "./components/runtimeLogging";
import DefaultsGate from "./DefaultsGate";
import MainWindowBoundary from "./MainWindowBoundary";

const MainShell = React.lazy(() => loadView(() => import("./main-shell")));

recordRuntimeLog("application", `前端入口执行：${Math.round(performance.now())} ms`, "info");
const root = ReactDOM.createRoot(document.getElementById("root")!);

root.render(
  <React.StrictMode>
    <MainWindowBoundary>
      <DefaultsGate>
        <React.Suspense fallback={<StartupFeedback />}>
          <MainShell />
        </React.Suspense>
      </DefaultsGate>
    </MainWindowBoundary>
  </React.StrictMode>,
);
