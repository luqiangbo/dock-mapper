import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Layout,
  Nav,
  Typography,
  Button,
  Badge,
  Tooltip,
  Avatar,
} from "@douyinfe/semi-ui";
import {
  IconGithubLogo,
  IconLive,
  IconKey,
  IconSetting,
  IconUser,
  IconMoon,
  IconSun,
  IconSidebar,
} from "@douyinfe/semi-icons";
import Dashboard from "./components/Dashboard";
import KeyMapper from "./components/KeyMapper";
import WidgetSettings from "./components/WidgetSettings";
import GeneralSettings from "./components/GeneralSettings";

const { Header, Sider, Content, Footer } = Layout;
const { Text, Title } = Typography;

// ─── Pages ──────────────────────────────────────────────────────────────
type PageKey = "dashboard" | "keymapper" | "widget" | "settings";

interface PageItem {
  key: PageKey;
  label: string;
  icon: React.ReactNode;
  component: React.ReactNode;
}

const PAGES: PageItem[] = [
  {
    key: "dashboard",
    label: "仪表盘",
    icon: <IconLive />,
    component: <Dashboard />,
  },
  {
    key: "keymapper",
    label: "按键映射",
    icon: <IconKey />,
    component: <KeyMapper />,
  },
  {
    key: "widget",
    label: "挂件设置",
    icon: <IconSidebar />,
    component: <WidgetSettings />,
  },
  {
    key: "settings",
    label: "全局设置",
    icon: <IconSetting />,
    component: <GeneralSettings />,
  },
];

// ─── Theme helpers ──────────────────────────────────────────────────────
type ThemeMode = "light" | "dark";
const THEME_KEY = "dev-taskbar-tools:theme";

function applyTheme(theme: ThemeMode) {
  const body = document.body;
  if (theme === "dark") body.setAttribute("theme-mode", "dark");
  else body.removeAttribute("theme-mode");
}

function loadTheme(): ThemeMode {
  const saved = localStorage.getItem(THEME_KEY);
  // If saved is 'system', resolve to the actual preference
  if (saved === "dark") return "dark";
  if (saved === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "light";
}

// ─── App ────────────────────────────────────────────────────────────────
export default function App() {
  const [activePage, setActivePage] = useState<PageKey>("dashboard");
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(loadTheme);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  // Init
  useEffect(() => {
    applyTheme(theme);
    // Sync native title bar theme on startup
    getCurrentWindow().setTheme(theme);

    invoke<boolean>("check_is_admin")
      .then((admin) => {
        setIsAdmin(admin);
        getCurrentWindow().setTitle(
          admin ? "DockMapper - 配置中心 [管理员]" : "DockMapper - 配置中心",
        );
      })
      .catch(() => {
        setIsAdmin(false);
        getCurrentWindow().setTitle("DockMapper - 配置中心");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTheme = () => {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    // Sync native title bar theme
    getCurrentWindow().setTheme(next);
    localStorage.setItem(THEME_KEY, next);
  };

  const currentPage = PAGES.find((p) => p.key === activePage)!;

  return (
    <Layout
      style={{
        height: "100vh",
        background: "var(--semi-color-bg-0)",
      }}
    >
      {/* ────────────────────────────────────────────────────────────
           Sider
      ──────────────────────────────────────────────────────────── */}
      <Sider
        style={{
          borderRight: "1px solid var(--semi-color-border)",
          display: "flex",
          flexDirection: "column",
          background: "var(--semi-color-bg-1)",
        }}
      >
        {/* Logo area */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: siderCollapsed ? "center" : "flex-start",
            padding: siderCollapsed ? "16px 0" : "16px 24px",
            gap: 10,
            borderBottom: "1px solid var(--semi-color-border)",
            minHeight: 56,
            overflow: "hidden",
            transition: "all 0.2s",
          }}
        >
          <Avatar
            size="small"
            style={{
              backgroundColor: "var(--semi-color-primary)",
              flexShrink: 0,
            }}
          >
            D
          </Avatar>
          {!siderCollapsed && (
            <Text strong style={{ fontSize: 15, whiteSpace: "nowrap" }}>
              DevTaskbar
            </Text>
          )}
        </div>

        {/* Navigation */}
        <Nav
          defaultSelectedKeys={["dashboard"]}
          selectedKeys={[activePage]}
          onSelect={(item) => setActivePage(item.itemKey as PageKey)}
          style={{
            flex: 1,
            borderRight: "none",
            background: "transparent",
          }}
          isCollapsed={siderCollapsed}
          footer={
            <div
              style={{
                padding: siderCollapsed ? "12px 0" : "12px 24px",
                borderTop: "1px solid var(--semi-color-border)",
                textAlign: "center",
              }}
            >
              <Button
                icon={<IconSidebar />}
                type="tertiary"
                size="small"
                onClick={() => setSiderCollapsed(!siderCollapsed)}
                style={{ width: siderCollapsed ? 36 : "100%" }}
              >
                {siderCollapsed ? "" : "收起"}
              </Button>
            </div>
          }
        >
          {PAGES.map((page) => (
            <Nav.Item
              key={page.key}
              itemKey={page.key}
              icon={page.icon}
              text={page.label}
            />
          ))}
        </Nav>
      </Sider>

      {/* ─── Right area: Header + Content + Footer ───────────────── */}
      <Layout style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        {/* ── Header ───────────────────────────────────────────── */}
        <Header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px",
            height: 52,
            borderBottom: "1px solid var(--semi-color-border)",
            background: "var(--semi-color-bg-1)",
            flexShrink: 0,
          }}
        >
          {/* Left: page title */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {currentPage.icon}
            <Title heading={6} style={{ margin: 0 }}>
              {currentPage.label}
            </Title>
          </div>

          {/* Right: admin status + theme toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* Admin status text */}
            <Tooltip
              content={
                isAdmin
                  ? "以管理员权限运行 — 按键映射在所有窗口生效"
                  : "普通用户权限 — 管理员窗口按键映射可能失效"
              }
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  padding: "2px 10px",
                  borderRadius: 12,
                  fontWeight: 500,
                  color: isAdmin
                    ? "var(--semi-color-success)"
                    : "var(--semi-color-text-2)",
                  background: isAdmin
                    ? "var(--semi-color-success-default, rgba(0,0,0,0.04))"
                    : "var(--semi-color-fill-0)",
                  border: isAdmin
                    ? "1px solid var(--semi-color-success)"
                    : "1px solid var(--semi-color-border)",
                }}
              >
                <IconUser size="small" />
                {isAdmin === null
                  ? "检测中…"
                  : isAdmin
                    ? "管理员"
                    : "普通用户"}
              </span>
            </Tooltip>

            {/* Theme toggle */}
            <Tooltip
              content={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
            >
              <Button
                icon={
                  theme === "dark" ? (
                    <IconSun size="large" />
                  ) : (
                    <IconMoon size="large" />
                  )
                }
                type="tertiary"
                size="small"
                onClick={toggleTheme}
                style={{ borderRadius: "50%", width: 36, height: 36 }}
              />
            </Tooltip>
          </div>
        </Header>

        {/* ── Content ─────────────────────────────────────────── */}
        <Content
          style={{
            padding: 24,
            overflowY: "auto",
            flex: 1,
            background: "var(--semi-color-bg-0)",
          }}
        >
          {currentPage.component}
        </Content>

        {/* ── Footer ──────────────────────────────────────────── */}
        <Footer
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 24px",
            borderTop: "1px solid var(--semi-color-border)",
            background: "var(--semi-color-bg-1)",
            flexShrink: 0,
            fontSize: 12,
          }}
        >
          <Text type="secondary" style={{ fontSize: 12 }}>
            DockMapper v1.0.4
          </Text>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
            }}
            onClick={() => {
              // Future: open GitHub repo
            }}
          >
            <IconGithubLogo size="small" />
            <Text type="secondary" style={{ fontSize: 12 }}>
              反馈 / 开源
            </Text>
          </div>
        </Footer>
      </Layout>
    </Layout>
  );
}
