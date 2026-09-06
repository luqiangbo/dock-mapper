import { useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Layout, Menu, Splitter, Tooltip, Typography } from "antd";
import {
  DashboardOutlined,
  CameraOutlined,
  GithubOutlined,
  KeyOutlined,
  FontSizeOutlined,
  MenuOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined,
} from "@ant-design/icons";
import Dashboard from "./components/Dashboard";
import KeyMapper from "./components/KeyMapper";
import WidgetSettings from "./components/WidgetSettings";
import PresentationSettings from "./components/PresentationSettings";
import GeneralSettings from "./components/GeneralSettings";
import ScreenshotSettings from "./components/ScreenshotSettings";
import { useTheme } from "./ThemeContext";
import appIcon from "./assets/app-icon.png";
import styles from "./App.module.scss";
import { MAIN_EVENTS } from "./api/commands";
import type { SysStatus } from "./types";
import { appendDashboardSample, type DashboardSample } from "./components/dashboardTelemetry";
import {
  loadSidebarWidth,
  saveSidebarWidth,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "./utils/sidebarPreferences";

const { Header, Content } = Layout;
const { Text, Title } = Typography;
const REPOSITORY_URL = "https://github.com/luqiangbo/dock-mapper";
type PageKey = "dashboard" | "keymapper" | "keyvisualizer" | "screenshot" | "widget" | "settings";
type ScreenshotTabKey = "history" | "settings";

interface MainNavigation {
  page: PageKey;
  tab?: ScreenshotTabKey;
}

interface PageItem {
  key: PageKey;
  label: string;
  icon: ReactNode;
}

const PAGES: PageItem[] = [
  { key: "dashboard", label: "仪表盘", icon: <DashboardOutlined /> },
  { key: "keymapper", label: "按键映射", icon: <KeyOutlined /> },
  { key: "keyvisualizer", label: "演示辅助", icon: <FontSizeOutlined /> },
  { key: "screenshot", label: "截图", icon: <CameraOutlined /> },
  { key: "widget", label: "挂件设置", icon: <MenuOutlined /> },
  { key: "settings", label: "全局设置", icon: <SettingOutlined /> },
];

export default function App() {
  const [activePage, setActivePage] = useState<PageKey>("dashboard");
  const [screenshotTab, setScreenshotTab] = useState<ScreenshotTabKey>("history");
  const [siderWidth, setSiderWidth] = useState(loadSidebarWidth);
  const [sysStatus, setSysStatus] = useState<SysStatus | null>(null);
  const [dashboardSamples, setDashboardSamples] = useState<DashboardSample[]>([]);
  const { resolved, setMode } = useTheme();

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<MainNavigation>(MAIN_EVENTS.navigate, ({ payload }) => {
      if (payload.page === "screenshot") {
        setScreenshotTab(payload.tab ?? "history");
      }
      setActivePage(payload.page);
    }).then((off) => {
      if (disposed) off();
      else unlisten = off;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<SysStatus>(MAIN_EVENTS.systemStatus, ({ payload }) => {
      setSysStatus(payload);
      setDashboardSamples((samples) => appendDashboardSample(samples, payload));
    }).then((off) => {
      if (disposed) off();
      else unlisten = off;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => saveSidebarWidth(siderWidth), 120);
    return () => window.clearTimeout(timer);
  }, [siderWidth]);

  const currentPage = PAGES.find((page) => page.key === activePage) ?? PAGES[0];
  const page = useMemo(() => {
    switch (activePage) {
      case "keymapper":
        return <KeyMapper />;
      case "screenshot":
        return (
          <ScreenshotSettings activeTab={screenshotTab} onActiveTabChange={setScreenshotTab} />
        );
      case "widget":
        return <WidgetSettings />;
      case "keyvisualizer":
        return <PresentationSettings />;
      case "settings":
        return <GeneralSettings />;
      default:
        return <Dashboard status={sysStatus} samples={dashboardSamples} onNavigate={(target, tab) => {
          if (target === "screenshot" && tab) setScreenshotTab(tab);
          setActivePage(target);
        }} />;
    }
  }, [activePage, dashboardSamples, screenshotTab, sysStatus]);

  return (
    <Splitter
      className={styles.shell}
      orientation="horizontal"
      onResize={(sizes) => {
        if (typeof sizes[0] === "number") setSiderWidth(sizes[0]);
      }}
    >
      <Splitter.Panel
        className={styles.siderPanel}
        size={siderWidth}
        min={SIDEBAR_MIN_WIDTH}
        max={SIDEBAR_MAX_WIDTH}
      >
        <aside className={styles.sider}>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              <img src={appIcon} alt="" />
            </span>
            <Text strong>DockMapper</Text>
          </div>

          <Menu
            selectedKeys={[activePage]}
            onClick={({ key }) => setActivePage(key as PageKey)}
            items={PAGES.map((item) => ({
              key: item.key,
              icon: item.icon,
              label: item.label,
            }))}
            className={styles.nav}
          />
        </aside>
      </Splitter.Panel>

      <Splitter.Panel className={styles.workspacePanel} min={0}>
        <Layout className={styles.workspace}>
          <Header className={styles.header}>
            <div className={styles.pageTitle}>
              {currentPage.icon}
              <Title level={5}>{currentPage.label}</Title>
            </div>
            <div className={styles.dragRegion} data-tauri-drag-region />
            <div className={styles.headerActions}>
              <Tooltip title="打开 GitHub">
                <Button
                  aria-label="打开 GitHub"
                  icon={<GithubOutlined />}
                  type="text"
                  onClick={() => void openUrl(REPOSITORY_URL)}
                />
              </Tooltip>
              <Tooltip title={resolved === "dark" ? "切换浅色" : "切换深色"}>
                <Button
                  aria-label="切换主题"
                  icon={resolved === "dark" ? <SunOutlined /> : <MoonOutlined />}
                  type="text"
                  onClick={() => setMode(resolved === "dark" ? "light" : "dark")}
                />
              </Tooltip>
              <div className={styles.windowControls}>
                <button
                  type="button"
                  aria-label="最小化窗口"
                  title="最小化"
                  onClick={() => void getCurrentWindow().minimize()}
                >
                  <svg viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M2.5 6h7" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="最大化或还原窗口"
                  title="最大化或还原"
                  onClick={() => void getCurrentWindow().toggleMaximize()}
                >
                  <svg viewBox="0 0 12 12" aria-hidden="true">
                    <rect x="2.5" y="2.5" width="7" height="7" rx="1" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="关闭窗口"
                  title="关闭"
                  onClick={() => void getCurrentWindow().close()}
                >
                  <svg viewBox="0 0 12 12" aria-hidden="true">
                    <path d="M3 3l6 6M9 3L3 9" />
                  </svg>
                </button>
              </div>
            </div>
          </Header>
          <Content className={styles.content}>{page}</Content>
        </Layout>
      </Splitter.Panel>
    </Splitter>
  );
}
