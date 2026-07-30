import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Layout, Nav, Typography, Button, Tooltip } from "@douyinfe/semi-ui";
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
import { useTheme } from "./ThemeContext";
import styles from "./App.module.css";

const { Header, Sider, Content } = Layout;
const { Text, Title } = Typography;
const REPOSITORY_URL = "https://github.com/luqiangbo/dock-mapper";

type PageKey = "dashboard" | "keymapper" | "widget" | "settings";

interface PageItem {
  key: PageKey;
  label: string;
  icon: ReactNode;
}

const PAGES: PageItem[] = [
  { key: "dashboard", label: "仪表盘", icon: <IconLive /> },
  { key: "keymapper", label: "按键映射", icon: <IconKey /> },
  { key: "widget", label: "挂件设置", icon: <IconSidebar /> },
  { key: "settings", label: "全局设置", icon: <IconSetting /> },
];

export default function App() {
  const [activePage, setActivePage] = useState<PageKey>("dashboard");
  const [siderCollapsed, setSiderCollapsed] = useState(window.innerWidth < 900);
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

    const media = window.matchMedia("(max-width: 760px)");
    const onNarrow = (event: MediaQueryListEvent) => {
      if (event.matches) setSiderCollapsed(true);
    };
    media.addEventListener("change", onNarrow);
    return () => media.removeEventListener("change", onNarrow);
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
    <Layout className={styles.shell}>
      <Sider className={`${styles.sider} ${siderCollapsed ? styles.collapsed : ""}`}>
        <div className={styles.windowControls} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">D</span>
          {!siderCollapsed && <Text strong>DockMapper</Text>}
        </div>

        <Nav
          selectedKeys={[activePage]}
          onSelect={(item) => setActivePage(item.itemKey as PageKey)}
          className={styles.nav}
          isCollapsed={siderCollapsed}
          footer={
            <Button
              aria-label={siderCollapsed ? "展开侧栏" : "收起侧栏"}
              icon={<IconSidebar />}
              type="tertiary"
              onClick={() => setSiderCollapsed((value) => !value)}
              className={styles.collapseButton}
            >
              {siderCollapsed ? "" : "收起侧栏"}
            </Button>
          }
        >
          {PAGES.map((item) => (
            <Nav.Item
              key={item.key}
              itemKey={item.key}
              icon={item.icon}
              text={item.label}
            />
          ))}
        </Nav>
      </Sider>

      <Layout className={styles.workspace}>
        <Header className={styles.header}>
          <div className={styles.pageTitle}>
            {currentPage.icon}
            <Title heading={5}>{currentPage.label}</Title>
          </div>
          <div className={styles.headerActions}>
            <Tooltip content={isAdmin ? "管理员权限，映射可作用于高权限窗口" : "普通权限"}>
              <span className={`${styles.statusChip} ${isAdmin ? styles.success : ""}`}>
                <IconUser />
                {isAdmin === null ? "检测中" : isAdmin ? "管理员" : "普通用户"}
              </span>
            </Tooltip>
            <Tooltip content="打开 GitHub">
              <Button
                aria-label="打开 GitHub"
                icon={<IconGithubLogo />}
                type="tertiary"
                onClick={() => void openUrl(REPOSITORY_URL)}
              />
            </Tooltip>
            <Tooltip content={resolved === "dark" ? "切换浅色" : "切换深色"}>
              <Button
                aria-label="切换主题"
                icon={resolved === "dark" ? <IconSun /> : <IconMoon />}
                type="tertiary"
                onClick={() => setMode(resolved === "dark" ? "light" : "dark")}
              />
            </Tooltip>
          </div>
        </Header>
        <Content className={styles.content}>{page}</Content>
      </Layout>
    </Layout>
  );
}
