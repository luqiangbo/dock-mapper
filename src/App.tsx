import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Layout, Menu, Splitter, Tooltip, Typography } from "antd";
import {
  DashboardOutlined,
  GithubOutlined,
  KeyOutlined,
  MenuOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined,
  UserOutlined,
} from "@ant-design/icons";
import Dashboard from "./components/Dashboard";
import KeyMapper from "./components/KeyMapper";
import WidgetSettings from "./components/WidgetSettings";
import GeneralSettings from "./components/GeneralSettings";
import { useTheme } from "./ThemeContext";
import styles from "./App.module.scss";

const { Header, Content } = Layout;
const { Text, Title } = Typography;
const REPOSITORY_URL = "https://github.com/luqiangbo/dock-mapper";
const SIDER_MIN_WIDTH = 168;
const SIDER_MAX_WIDTH = 320;
const SIDER_INITIAL_WIDTH = 208;

type PageKey = "dashboard" | "keymapper" | "widget" | "settings";

interface PageItem {
  key: PageKey;
  label: string;
  icon: ReactNode;
}

const PAGES: PageItem[] = [
  { key: "dashboard", label: "仪表盘", icon: <DashboardOutlined /> },
  { key: "keymapper", label: "按键映射", icon: <KeyOutlined /> },
  { key: "widget", label: "挂件设置", icon: <MenuOutlined /> },
  { key: "settings", label: "全局设置", icon: <SettingOutlined /> },
];

export default function App() {
  const [activePage, setActivePage] = useState<PageKey>("dashboard");
  const [siderWidth, setSiderWidth] = useState(SIDER_INITIAL_WIDTH);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const { resolved, setMode } = useTheme();

  useEffect(() => {
    invoke<boolean>("check_is_admin")
      .then((admin) => {
        setIsAdmin(admin);
        return getCurrentWindow().setTitle(
          admin ? "DockMapper - 配置中心 [管理员]" : "DockMapper - 配置中心",
        );
      })
      .catch(() => setIsAdmin(false));
  }, []);

  const currentPage = PAGES.find((page) => page.key === activePage) ?? PAGES[0];
  const page = useMemo(() => {
    switch (activePage) {
      case "keymapper":
        return <KeyMapper />;
      case "widget":
        return <WidgetSettings />;
      case "settings":
        return <GeneralSettings />;
      default:
        return <Dashboard />;
    }
  }, [activePage]);

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
        min={SIDER_MIN_WIDTH}
        max={SIDER_MAX_WIDTH}
      >
        <aside className={styles.sider}>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              D
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
              <Tooltip
                title={
                  isAdmin === null
                    ? "正在检测权限"
                    : isAdmin
                      ? "管理员权限，映射可作用于高权限窗口"
                      : "普通用户权限"
                }
              >
                <Button
                  aria-label={isAdmin ? "管理员权限" : "普通用户权限"}
                  type="text"
                  icon={<UserOutlined />}
                  className={`${styles.statusButton} ${isAdmin ? styles.success : ""}`}
                />
              </Tooltip>
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
