import { App as AntApp, ConfigProvider, theme as antdTheme } from "antd";
import App from "./App";
import { ThemeProvider, useTheme } from "./ThemeContext";
import "./global.scss";
import { accentColors, themePalettes } from "./themePalette";

function ThemedApp() {
  const { accentColor, resolved } = useTheme();
  const palette = themePalettes[resolved];
  const accent = accentColors(accentColor, resolved);

  return (
    <ConfigProvider
      componentSize="middle"
      theme={{
        algorithm: resolved === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: accent.solid,
          colorInfo: accent.solid,
          colorLink: accent.foreground,
          colorLinkHover: accent.foreground,
          colorLinkActive: accent.foreground,
          borderRadius: 6,
          controlHeight: 32,
          fontSize: 14,
          fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif',
          colorText: palette["text-primary"],
          colorTextSecondary: palette["text-secondary"],
          colorBgContainer: palette["surface-base"],
          colorBgElevated: palette["surface-base"],
          colorBorder: palette["glass-border"],
          colorBorderSecondary: palette["glass-border"],
          colorTextDisabled: palette["text-tertiary"],
          colorBgContainerDisabled: palette["surface-muted"],
        },
        components: {
          Button: {
            borderRadius: 6,
            primaryShadow: "none",
            defaultBg: palette["glass-control"],
            defaultBorderColor: palette["glass-border"],
            defaultColor: palette["text-primary"],
            defaultHoverBg: palette["glass-control-hover"],
            defaultHoverBorderColor: palette["glass-border"],
            defaultHoverColor: palette["text-primary"],
            defaultActiveBg: palette["glass-control-active"],
            defaultActiveBorderColor: palette["glass-border"],
            defaultActiveColor: palette["text-primary"],
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

export default function MainShell() {
  return (
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  );
}
