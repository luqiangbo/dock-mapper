import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { App as AntApp, Button, Grid, Layout, Menu, Splitter, Tooltip, Typography } from "antd";
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
import { useTheme } from "./ThemeContext";
import appIcon from "./assets/app-icon.png";
import styles from "./App.module.scss";
import { MAIN_EVENTS } from "./api/commands";
import {
  loadSidebarWidth,
  saveSidebarWidth,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "./utils/sidebarPreferences";

import DeferredPage from "./components/DeferredPage";
import TelemetryCollector from "./components/TelemetryCollector";
import {
  loadNavigationPreferences,
  saveNavigationPreferences,
  isMainNavigation,
  type PageKey,
  type ScreenshotTabKey,
  type MainNavigation,
} from "./utils/navigationPreferences";
import { useCompactNavigation } from "./hooks/useCompactNavigation";
const LOADERS = {
  dashboard: () => import("./components/ConnectedDashboard"),
  keymapper: () => import("./components/KeyMapper"),
  keyvisualizer: () => import("./components/KeyVisualizerSettings"),
  screenshot: () => import("./components/ScreenshotSettings"),
  widget: () => import("./components/WidgetSettings"),
  settings: () => import("./components/GeneralSettings"),
};

const { Header, Content } = Layout;
const { Text, Title } = Typography;
const REPOSITORY_URL = "https://github.com/luqiangbo/dock-mapper";
interface PageItem {
  key: PageKey;
  label: string;
  icon: ReactNode;
}

const PAGES: PageItem[] = [
  { key: "dashboard", label: "仪表盘", icon: <DashboardOutlined /> },
  { key: "keymapper", label: "按键映射", icon: <KeyOutlined /> },
  { key: "keyvisualizer", label: "按键展示", icon: <FontSizeOutlined /> },
  { key: "screenshot", label: "截图", icon: <CameraOutlined /> },
  { key: "widget", label: "挂件设置", icon: <MenuOutlined /> },
  { key: "settings", label: "全局设置", icon: <SettingOutlined /> },
];
const menuItem = ({ key, label, icon }: PageItem) => ({ key, label, icon });

export default function App() {
  const { notification } = AntApp.useApp();
  const screens = Grid.useBreakpoint();
  const compactNavigation = useCompactNavigation();
  const [initialNavigation] = useState(loadNavigationPreferences);
  const contentRef = useRef<HTMLDivElement>(null);
  const [activePage, setActivePage] = useState<PageKey>(initialNavigation.page);
  const [screenshotTab, setScreenshotTab] = useState<ScreenshotTabKey>(initialNavigation.tab);
  const [siderWidth, setSiderWidth] = useState(loadSidebarWidth);
  const { resolved, setMode } = useTheme();

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<MainNavigation>(MAIN_EVENTS.navigate, ({ payload }) => {
      if (!isMainNavigation(payload)) return;
      if (payload.page === "screenshot") {
        setScreenshotTab(payload.tab ?? "history");
      }
      setActivePage(payload.page);
    })
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      })
      .catch((error) =>
        notification.error({ message: "页面导航监听失败", description: String(error) }),
      );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [notification]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<string>(MAIN_EVENTS.historyWriteFailed, ({ payload }) => {
      try {
        window.sessionStorage.setItem("dockmapper.history-write-error", payload);
      } catch (error) {
        console.error("历史写入错误暂存失败", error);
      }
      notification.warning({
        message: "截图操作已完成，但未保存到历史",
        description: payload,
        duration: 8,
      });
    })
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      })
      .catch((error) =>
        notification.warning({ message: "截图历史错误监听失败", description: String(error) }),
      );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [notification]);

  useEffect(() => {
    const timer = window.setTimeout(() => saveSidebarWidth(siderWidth), 120);
    return () => window.clearTimeout(timer);
  }, [siderWidth]);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
    try {
      saveNavigationPreferences({ page: activePage, tab: screenshotTab });
    } catch (error) {
      notification.warning({ message: "页面偏好未保存", description: String(error) });
    }
  }, [activePage, screenshotTab, notification]);

  const currentPage = PAGES.find((page) => page.key === activePage) ?? PAGES[0];
  const page = useMemo(() => {
    switch (activePage) {
      case "keymapper":
        return <DeferredPage key="keymapper" load={LOADERS.keymapper} pageProps={{}} />;
      case "screenshot":
        return (
          <DeferredPage
            key="screenshot"
            load={LOADERS.screenshot}
            pageProps={{ activeTab: screenshotTab, onActiveTabChange: setScreenshotTab }}
          />
        );
      case "widget":
        return <DeferredPage key="widget" load={LOADERS.widget} pageProps={{}} />;
      case "keyvisualizer":
        return <DeferredPage key="keyvisualizer" load={LOADERS.keyvisualizer} pageProps={{}} />;
      case "settings":
        return <DeferredPage key="settings" load={LOADERS.settings} pageProps={{}} />;
      default:
        return (
          <DeferredPage
            key="dashboard"
            load={LOADERS.dashboard}
            pageProps={{
              onNavigate: (
                target: "keymapper" | "screenshot" | "widget",
                tab?: ScreenshotTabKey,
              ) => {
                if (target === "screenshot" && tab) setScreenshotTab(tab);
                setActivePage(target);
              },
            }}
          />
        );
    }
  }, [activePage, screenshotTab]);

  return (
    <>
      <TelemetryCollector />
      <Splitter
        className={styles.shell}
        orientation="horizontal"
        onResize={(sizes) => {
          if (!compactNavigation && typeof sizes[0] === "number") setSiderWidth(sizes[0]);
        }}
      >
        <Splitter.Panel
          className={`${styles.siderPanel} ${compactNavigation ? styles.siderPanelCompact : ""}`}
          size={compactNavigation ? 64 : siderWidth}
          min={compactNavigation ? 64 : SIDEBAR_MIN_WIDTH}
          max={compactNavigation ? 64 : SIDEBAR_MAX_WIDTH}
          resizable={!compactNavigation}
        >
          <aside className={styles.sider}>
            <div className={styles.brand}>
              <span className={styles.brandMark} aria-hidden="true">
                <img src={appIcon} alt="" />
              </span>
              {!compactNavigation && <Text strong>DockMapper</Text>}
            </div>

            <Menu
              mode="inline"
              selectedKeys={[activePage]}
              inlineCollapsed={compactNavigation}
              onClick={({ key }) => setActivePage(key as PageKey)}
              items={[
                {
                  type: "group",
                  label: compactNavigation ? null : "工具",
                  children: PAGES.slice(0, 4).map(menuItem),
                },
                {
                  type: "group",
                  label: compactNavigation ? null : "配置",
                  children: PAGES.slice(4, 5).map(menuItem),
                },
              ]}
              className={styles.nav}
            />
            <Menu
              mode="inline"
              selectedKeys={[activePage]}
              inlineCollapsed={compactNavigation}
              onClick={() => setActivePage("settings")}
              items={[menuItem(PAGES[5])]}
              className={styles.bottomNav}
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
                {screens.md && (
                  <Tooltip title="打开 GitHub">
                    <Button
                      aria-label="打开 GitHub"
                      icon={<GithubOutlined />}
                      type="text"
                      onClick={() => void openUrl(REPOSITORY_URL)}
                    />
                  </Tooltip>
                )}
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
            <Content ref={contentRef} className={styles.content}>
              {page}
            </Content>
          </Layout>
        </Splitter.Panel>
      </Splitter>
    </>
  );
}
