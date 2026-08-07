import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntApp, ConfigProvider, theme as antdTheme } from "antd";
import App from "./App";
import { ThemeProvider, useTheme } from "./ThemeContext";
import "./global.scss";

function ThemedApp() {
  const { accentColor, resolved } = useTheme();

  return (
    <ConfigProvider
      componentSize="small"
      theme={{
        algorithm: resolved === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: accentColor,
          borderRadius: 10,
        },
        components: {
          Button: {
            borderRadius: 8,
            primaryShadow: "none",
            defaultBg: "var(--glass-control)",
            defaultBorderColor: "var(--glass-border)",
            defaultColor: "var(--text-primary)",
            defaultHoverBg: "var(--glass-control-hover)",
            defaultHoverBorderColor: accentColor,
            defaultHoverColor: accentColor,
            defaultActiveBg: "var(--glass-control-active)",
            defaultActiveBorderColor: accentColor,
            defaultActiveColor: accentColor,
          },
        },
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  </React.StrictMode>,
);
