import "./utils/disableBrowserContextMenu";
import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, theme as antdTheme } from "antd";
import PinImage from "./screenshots/screenshot/components/PinImage";
import { useWindowTheme } from "./hooks/useWindowTheme";
import { accentColors } from "./themePalette";
import "./screenshots/screenshot/assets/main.css";

function PinWindow() {
  const { accentColor } = useWindowTheme();
  return (
    <ConfigProvider
      theme={{
        algorithm: antdTheme.darkAlgorithm,
        token: { colorPrimary: accentColors(accentColor, "dark").solid },
      }}
    >
      <PinImage />
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PinWindow />
  </React.StrictMode>,
);
