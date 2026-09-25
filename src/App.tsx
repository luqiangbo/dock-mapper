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
import Dashboard from "./components/Dashboard";
import KeyMapper from "./components/KeyMapper";
import WidgetSettings from "./components/WidgetSettings";
import KeyVisualizerSettings from "./components/KeyVisualizerSettings";
import GeneralSettings from "./components/GeneralSettings";
import ScreenshotSettings from "./components/ScreenshotSettings";
import { useTheme } from "./ThemeContext";
import appIcon from "./assets/app-icon.png";
import styles from "./App.module.scss";
import { MAIN_EVENTS, widgetApi } from "./api/commands";
import type { SysStatus } from "./types";
import { appendDashboardSample, type DashboardSample } from "./components/dashboardTelemetry";
import { appendTelemetryArchive, loadTelemetryArchive, saveTelemetryArchive } from "./components/telemetryArchive";
import { useTelemetryFreshness } from "./utils/telemetryFreshness";
import { evaluateTelemetryAlerts, initialAlertState, loadAlertInbox, saveAlertInbox, type AlertEntry, type AlertRules } from "./components/telemetryAlerts";
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
  { key: "keyvisualizer", label: "按键展示", icon: <FontSizeOutlined /> },
  { key: "screenshot", label: "截图", icon: <CameraOutlined /> },
  { key: "widget", label: "挂件设置", icon: <MenuOutlined /> },
  { key: "settings", label: "全局设置", icon: <SettingOutlined /> },
];

export default function App() {
  const { notification } = AntApp.useApp();
  const screens = Grid.useBreakpoint();
  const compactNavigation = !screens.md;
  const [activePage, setActivePage] = useState<PageKey>("dashboard");
  const [screenshotTab, setScreenshotTab] = useState<ScreenshotTabKey>("history");
  const [siderWidth, setSiderWidth] = useState(loadSidebarWidth);
  const [sysStatus, setSysStatus] = useState<SysStatus | null>(null);
  const [lastSampleAt, setLastSampleAt] = useState<number | null>(null);
  const [dashboardSamples, setDashboardSamples] = useState<DashboardSample[]>([]);
  const [telemetryArchive, setTelemetryArchive] = useState<DashboardSample[]>(loadTelemetryArchive);
  const archiveRef = useRef(telemetryArchive);
  const archiveSavedAtRef = useRef(0);
  const [alerts, setAlerts] = useState<AlertEntry[]>(loadAlertInbox);
  const alertsRef = useRef(alerts);
  const alertStateRef = useRef(initialAlertState(alerts));
  const alertRulesRef = useRef<AlertRules>({ cpu_percent: null, memory_percent: null, battery_below_percent: null });
  const freshness = useTelemetryFreshness(lastSampleAt);
  const { resolved, setMode } = useTheme();

  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    void widgetApi.config().then((config) => {
      if (!disposed) alertRulesRef.current = config.alerts;
    }).catch((error) => notification.warning({ message: "提醒规则读取失败", description: String(error) }));
    void listen<{ alerts: AlertRules }>("widget-config-changed", ({ payload }) => {
      if (JSON.stringify(alertRulesRef.current) !== JSON.stringify(payload.alerts)) {
        alertStateRef.current = {
          counts: initialAlertState().counts,
          lastAlertAt: alertStateRef.current.lastAlertAt,
        };
      }
      alertRulesRef.current = payload.alerts;
    }).then((unlisten) => {
      if (disposed) unlisten(); else off = unlisten;
    }).catch((error) => notification.warning({ message: "提醒规则监听失败", description: String(error) }));
    return () => { disposed = true; off?.(); };
  }, [notification]);

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
    void listen<string>(MAIN_EVENTS.historyWriteFailed, ({ payload }) => {
      window.sessionStorage.setItem("dockmapper.history-write-error", payload);
      notification.warning({
        message: "截图操作已完成，但未保存到历史",
        description: payload,
        duration: 8,
      });
    }).then((off) => {
      if (disposed) off();
      else unlisten = off;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [notification]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<SysStatus>(MAIN_EVENTS.systemStatus, ({ payload }) => {
      const now = Date.now();
      const evaluated = evaluateTelemetryAlerts(alertStateRef.current, alertRulesRef.current, payload, now);
      alertStateRef.current = evaluated.state;
      if (evaluated.alerts.length) {
        const nextAlerts = [...alertsRef.current, ...evaluated.alerts].slice(-50);
        alertsRef.current = nextAlerts;
        setAlerts(nextAlerts);
        try { saveAlertInbox(nextAlerts); }
        catch (error) { notification.warning({ message: "提醒记录保存失败", description: String(error) }); }
        for (const alert of evaluated.alerts) notification.warning({ message: "系统指标超过提醒阈值", description: `${alert.kind === "cpu" ? "CPU" : alert.kind === "memory" ? "内存" : "电池"} ${alert.value.toFixed(0)}%` });
      }
      setLastSampleAt(now);
      setSysStatus(payload);
      setDashboardSamples((samples) => appendDashboardSample(samples, payload));
      const nextArchive = appendTelemetryArchive(archiveRef.current, payload, now);
      archiveRef.current = nextArchive;
      setTelemetryArchive(nextArchive);
      if (now - archiveSavedAtRef.current >= 60_000) {
        try {
          saveTelemetryArchive(nextArchive);
          archiveSavedAtRef.current = now;
        } catch (error) {
          notification.warning({ message: "长期趋势保存失败", description: String(error) });
          archiveSavedAtRef.current = now;
        }
      }
    }).then((off) => {
      if (disposed) off();
      else unlisten = off;
    });
    return () => {
      disposed = true;
      unlisten?.();
      try { saveTelemetryArchive(archiveRef.current); } catch { /* The active window already reported a save failure. */ }
    };
  }, [notification]);

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
        return <KeyVisualizerSettings />;
      case "settings":
        return <GeneralSettings />;
      default:
        return (
          <Dashboard
            status={freshness === "live" ? sysStatus : null}
            freshness={freshness}
            samples={dashboardSamples}
            archive={telemetryArchive}
            alerts={alerts}
            onMarkAlertsRead={() => {
              const previous = alertsRef.current;
              const next = previous.map((alert) => ({ ...alert, read: true }));
              try {
                saveAlertInbox(next);
                alertsRef.current = next;
                setAlerts(next);
              }
              catch (error) { notification.error({ message: "提醒状态保存失败", description: String(error) }); }
            }}
            onNavigate={(target, tab) => {
              if (target === "screenshot" && tab) setScreenshotTab(tab);
              setActivePage(target);
            }}
          />
        );
    }
  }, [activePage, alerts, dashboardSamples, freshness, notification, screenshotTab, sysStatus, telemetryArchive]);

  return (
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
            selectedKeys={[activePage]}
            inlineCollapsed={compactNavigation}
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
          <Content className={styles.content}>{page}</Content>
        </Layout>
      </Splitter.Panel>
    </Splitter>
  );
}
