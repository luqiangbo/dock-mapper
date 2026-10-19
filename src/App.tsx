import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  App as AntApp,
  Button,
  Grid,
  Layout,
  Menu,
  Splitter,
  Tabs,
  Tooltip,
  Typography,
} from "antd";
import {
  DashboardOutlined,
  CameraOutlined,
  GithubOutlined,
  KeyOutlined,
  FontSizeOutlined,
  DesktopOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined,
  MinusOutlined,
  BorderOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import { useTheme } from "./ThemeContext";
import appIcon from "./assets/app-icon.png";
import styles from "./App.module.scss";
import { revealWorkspaceFocus } from "./utils/workspaceFocus";
import { MAIN_EVENTS } from "./api/commands";
import {
  loadSidebarWidth,
  saveSidebarWidth,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "./utils/sidebarPreferences";

import PageBoundary from "./components/PageBoundary";
import WorkspaceScrollRuler from "./components/WorkspaceScrollRuler";
import ConnectedDashboard from "./components/ConnectedDashboard";
import KeyMapper from "./components/KeyMapper";
import KeyVisualizerSettings from "./components/KeyVisualizerSettings";
import ScreenshotSettings from "./components/ScreenshotSettings";
import WidgetSettings from "./components/WidgetSettings";
import GeneralSettings from "./components/GeneralSettings";
import { PageScope } from "./components/PageActivity";
import TelemetryCollector from "./components/TelemetryCollector";
import CaptureStartupFeedback from "./components/CaptureStartupFeedback";
import {
  loadNavigationPreferences,
  saveNavigationPreferences,
  isMainNavigation,
  type PageKey,
  type ScreenshotTabKey,
  type MainNavigation,
} from "./utils/navigationPreferences";
import { useCompactNavigation } from "./hooks/useCompactNavigation";

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
  { key: "widget", label: "任务栏挂件", icon: <DesktopOutlined /> },
  { key: "settings", label: "全局设置", icon: <SettingOutlined /> },
];
const menuItem = ({ key, label, icon }: PageItem) => ({
  key,
  label,
  icon,
});

export default function App() {
  const { notification } = AntApp.useApp();
  const screens = Grid.useBreakpoint();
  const compactNavigation = useCompactNavigation();
  const [initialNavigation] = useState(loadNavigationPreferences);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Partial<Record<PageKey, number>>>({});
  const [activePage, setActivePage] = useState<PageKey>(initialNavigation.page);
  const activePageRef = useRef(activePage);
  const navigateTo = useCallback((page: PageKey) => {
    if (page === activePageRef.current) return;
    scrollPositions.current[activePageRef.current] = contentRef.current?.scrollTop ?? 0;
    setActivePage(page);
  }, []);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<string>("key-mapping-error", ({ payload }) => {
      navigateTo("keymapper");
      notification.error({ message: "按键映射提示", description: payload });
    })
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      })
      .catch((error) =>
        notification.error({ message: "按键映射通知监听失败", description: String(error) }),
      );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [navigateTo, notification]);
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
      navigateTo(payload.page);
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
  }, [notification, navigateTo]);

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
    try {
      saveNavigationPreferences({ page: activePage, tab: screenshotTab });
    } catch (error) {
      notification.warning({ message: "页面偏好未保存", description: String(error) });
    }
  }, [activePage, screenshotTab, notification]);

  useLayoutEffect(() => {
    activePageRef.current = activePage;
    contentRef.current?.scrollTo({
      top: scrollPositions.current[activePage] ?? 0,
      behavior: "instant",
    });
  }, [activePage]);

  const currentPage = PAGES.find((page) => page.key === activePage) ?? PAGES[0];
  const renderPage = (key: PageKey) => {
    switch (key) {
      case "keymapper":
        return <KeyMapper />;
      case "screenshot":
        return (
          <ScreenshotSettings activeTab={screenshotTab} onActiveTabChange={setScreenshotTab} />
        );
      case "widget":
        return <WidgetSettings />;
      case "keyvisualizer":
        return <KeyVisualizerSettings />;
      case "settings":
        return <GeneralSettings />;
      default:
        return <ConnectedDashboard />;
    }
  };

  return (
    <>
      <TelemetryCollector />
      <CaptureStartupFeedback />
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
              onClick={({ key }) => navigateTo(key as PageKey)}
              items={PAGES.filter((page) => page.key !== "settings").map(menuItem)}
              className={styles.nav}
            />
            <Menu
              mode="inline"
              selectedKeys={[activePage]}
              inlineCollapsed={compactNavigation}
              onClick={() => navigateTo("settings")}
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
                  <Button
                    type="text"
                    icon={<MinusOutlined />}
                    aria-label="最小化窗口"
                    title="最小化"
                    onClick={() =>
                      void getCurrentWindow()
                        .minimize()
                        .catch((error) =>
                          notification.error({ message: "最小化失败", description: String(error) }),
                        )
                    }
                  />
                  <Button
                    type="text"
                    icon={<BorderOutlined />}
                    aria-label="最大化或还原窗口"
                    title="最大化或还原"
                    onClick={() =>
                      void getCurrentWindow()
                        .toggleMaximize()
                        .catch((error) =>
                          notification.error({
                            message: "调整窗口失败",
                            description: String(error),
                          }),
                        )
                    }
                  />
                  <Button
                    type="text"
                    danger
                    icon={<CloseOutlined />}
                    aria-label="关闭窗口"
                    title="关闭"
                    onClick={() =>
                      void getCurrentWindow()
                        .close()
                        .catch((error) =>
                          notification.error({
                            message: "关闭窗口失败",
                            description: String(error),
                          }),
                        )
                    }
                  />
                </div>
              </div>
            </Header>
            <Content
              id="workspace-content"
              ref={contentRef}
              className={styles.content}
              onFocusCapture={(event) => {
                if (contentRef.current && event.target instanceof HTMLElement)
                  revealWorkspaceFocus(contentRef.current, event.target);
              }}
            >
              <div>
                <Tabs
                  activeKey={activePage}
                  destroyOnHidden={false}
                  renderTabBar={() => <></>}
                  animated={false}
                  items={PAGES.map(({ key, label }) => ({
                    key,
                    label,
                    children: (
                      <PageScope active={activePage === key}>
                        <PageBoundary pageKey={key}>{renderPage(key)}</PageBoundary>
                      </PageScope>
                    ),
                  }))}
                />
              </div>
            </Content>
            <WorkspaceScrollRuler contentRef={contentRef} pageKey={activePage} />
          </Layout>
        </Splitter.Panel>
      </Splitter>
    </>
  );
}
