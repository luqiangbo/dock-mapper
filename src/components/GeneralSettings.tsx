import React, { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  enable as autoStartEnable,
  disable as autoStartDisable,
  isEnabled as autoStartIsEnabled,
} from "@tauri-apps/plugin-autostart";
import {
  Card,
  Typography,
  Switch,
  RadioGroup,
  Radio,
  Space,
  Divider,
  Notification,
  Banner,
  Spin,
} from "@douyinfe/semi-ui";
import { IconMoon, IconSun } from "@douyinfe/semi-icons";

const { Text } = Typography;

type ThemeMode = "light" | "dark" | "system";

const THEME_KEY = "dev-taskbar-tools:theme";

function loadTheme(): ThemeMode {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark" || saved === "system") return saved;
  return "system";
}

function applyTheme(theme: ThemeMode) {
  const body = document.body;
  if (theme === "dark") {
    body.setAttribute("theme-mode", "dark");
  } else if (theme === "system") {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    if (prefersDark) body.setAttribute("theme-mode", "dark");
    else body.removeAttribute("theme-mode");
  } else {
    body.removeAttribute("theme-mode");
  }
}

export default function GeneralSettings() {
  const [autoStart, setAutoStart] = useState(false);
  const [autoStartLoading, setAutoStartLoading] = useState(true);
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [minimizeLoading, setMinimizeLoading] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>(loadTheme);

  useEffect(() => {
    applyTheme(theme);

    // ── Load actual auto-start state ────────────────────────────────
    autoStartIsEnabled()
      .then((enabled) => {
        setAutoStart(enabled);
        setAutoStartLoading(false);
      })
      .catch((err) => {
        console.error("Failed to check auto-start state:", err);
        setAutoStartLoading(false);
      });

    // ── Load minimize-to-tray state ─────────────────────────────────
    invoke<boolean>("get_minimize_to_tray")
      .then((val) => {
        setMinimizeToTray(val);
        setMinimizeLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load minimize-to-tray state:", err);
        setMinimizeLoading(false);
      });
  }, []);

  // ── Auto-start toggle ─────────────────────────────────────────────
  const handleAutoStartChange = useCallback(async (checked: boolean) => {
    setAutoStart(checked);
    try {
      if (checked) {
        await autoStartEnable();
        Notification.success({ content: "开机自启已开启" });
      } else {
        await autoStartDisable();
        Notification.info({ content: "开机自启已关闭" });
      }
    } catch (err) {
      setAutoStart(!checked); // revert on failure
      Notification.error({ content: `操作失败: ${err}` });
    }
  }, []);

  // ── Minimize-to-tray toggle ──────────────────────────────────────
  const handleMinimizeChange = useCallback(async (checked: boolean) => {
    setMinimizeToTray(checked);
    try {
      await invoke("set_minimize_to_tray", { enabled: checked });
      Notification.info({
        content: checked
          ? "关闭窗口时将最小化到系统托盘"
          : "关闭窗口时将直接退出程序",
      });
    } catch (err) {
      setMinimizeToTray(!checked); // revert on failure
      Notification.error({ content: `操作失败: ${err}` });
    }
  }, []);

  const handleThemeChange = (next: ThemeMode) => {
    setTheme(next);
    // Persist theme to localStorage (the App component reads it)
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── General options ───────────────────────────────────── */}
      <Card title="通用选项" style={{ borderRadius: 8 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* Auto-start */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <Text strong>开机自动启动</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                系统启动时自动运行本工具
              </Text>
            </div>
            {autoStartLoading ? (
              <Spin size="small" />
            ) : (
              <Switch
                checked={autoStart}
                onChange={handleAutoStartChange}
                loading={autoStartLoading}
              />
            )}
          </div>

          <Divider style={{ margin: "4px 0" }} />

          {/* Minimize to system tray */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <Text strong>最小化到系统托盘</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                关闭窗口时最小化到托盘而非退出
              </Text>
            </div>
            {minimizeLoading ? (
              <Spin size="small" />
            ) : (
              <Switch
                checked={minimizeToTray}
                onChange={handleMinimizeChange}
              />
            )}
          </div>
        </div>
      </Card>

      {/* ── Admin tip ─────────────────────────────────────────── */}
      <Banner
        type="info"
        closeIcon={null}
        title="关于管理员权限"
        description="全局按键映射需要以管理员身份运行才能在所有窗口中生效。如需提权，请前往「仪表盘」页面点击提权按钮。开机自启以当前用户权限启动，不会自动以管理员身份运行。"
        style={{ borderRadius: 8 }}
      />

      {/* ── Appearance ────────────────────────────────────────── */}
      <Card title="外观风格" style={{ borderRadius: 8 }}>
        <RadioGroup
          type="button"
          value={theme}
          onChange={(e: any) => handleThemeChange(e.target.value as ThemeMode)}
          aria-label="主题模式"
        >
          <Radio value="light">
            <IconMoon style={{ marginRight: 4 }} />
            浅色
          </Radio>
          <Radio value="dark">
            <IconSun style={{ marginRight: 4 }} />
            深色
          </Radio>
          <Radio value="system">跟随系统</Radio>
        </RadioGroup>
      </Card>

      {/* ── About ─────────────────────────────────────────────── */}
      <Card title="关于" style={{ borderRadius: 8 }}>
        <Space align="center">
          <div>
            <Text strong style={{ fontSize: 16 }}>
              DockMapper
            </Text>
            <br />
            <Text type="secondary">版本 v1.0.4</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              基于 Tauri 2.0 + React + Semi Design 构建
            </Text>
            <br />
            <Text
              type="secondary"
              style={{
                fontSize: 12,
                cursor: "pointer",
                color: "var(--semi-color-primary)",
              }}
              onClick={() => {
                // Future: open GitHub repo
              }}
            >
              反馈 / 开源地址 →
            </Text>
          </div>
        </Space>
      </Card>
    </div>
  );
}
