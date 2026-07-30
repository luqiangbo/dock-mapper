import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import {
  Banner,
  Button,
  Card,
  Modal,
  Notification,
  Radio,
  RadioGroup,
  Spin,
  Switch,
  Typography,
} from "@douyinfe/semi-ui";
import { IconRefresh } from "@douyinfe/semi-icons";
import { useTheme } from "../ThemeContext";
import type { ThemeMode } from "../types";
import styles from "./components.module.css";

const { Text } = Typography;
const REPOSITORY_URL = "https://github.com/luqiangbo/dock-mapper";

export default function GeneralSettings() {
  const [autoStart, setAutoStart] = useState(false);
  const [autoStartLoading, setAutoStartLoading] = useState(true);
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [minimizeLoading, setMinimizeLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [version, setVersion] = useState("—");
  const { mode, setMode } = useTheme();

  useEffect(() => {
    void isAutostartEnabled()
      .then(setAutoStart)
      .catch((error) => console.error("读取开机启动状态失败", error))
      .finally(() => setAutoStartLoading(false));
    void invoke<boolean>("get_minimize_to_tray")
      .then(setMinimizeToTray)
      .catch((error) => console.error("读取托盘设置失败", error))
      .finally(() => setMinimizeLoading(false));
    void getVersion().then(setVersion).catch(() => setVersion("未知"));
  }, []);

  const changeAutostart = useCallback(async (checked: boolean) => {
    setAutoStartLoading(true);
    try {
      if (checked) await enableAutostart();
      else await disableAutostart();
      setAutoStart(checked);
      Notification.success({ content: checked ? "开机自启已开启" : "开机自启已关闭" });
    } catch (error) {
      Notification.error({ content: `操作失败：${error}` });
    } finally {
      setAutoStartLoading(false);
    }
  }, []);

  const changeMinimize = useCallback(async (checked: boolean) => {
    setMinimizeLoading(true);
    try {
      await invoke("set_minimize_to_tray", { enabled: checked });
      setMinimizeToTray(checked);
    } catch (error) {
      Notification.error({ content: `操作失败：${error}` });
    } finally {
      setMinimizeLoading(false);
    }
  }, []);

  const checkForUpdate = async () => {
    setChecking(true);
    try {
      const update = await check();
      if (!update) {
        Notification.success({ content: "当前已是最新版本" });
        return;
      }
      Modal.confirm({
        title: `发现 DockMapper ${update.version}`,
        content: "下载完成后应用将自动重启。",
        okText: "下载并安装",
        cancelText: "稍后",
        onOk: async () => {
          await update.downloadAndInstall();
          await relaunch();
        },
      });
    } catch (error) {
      Notification.error({ content: `检查更新失败：${error}` });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className={styles.page}>
      <Card className={styles.surfaceCard} title="通用">
        <div className={styles.settingsGroup}>
          <div className={styles.settingRow}>
            <div className={styles.settingCopy}>
              <Text strong>开机自动启动</Text>
              <span className={styles.description}>登录 Windows 后自动运行</span>
            </div>
            {autoStartLoading ? (
              <Spin size="small" />
            ) : (
              <Switch checked={autoStart} onChange={(value) => void changeAutostart(value)} />
            )}
          </div>
          <div className={styles.settingRow}>
            <div className={styles.settingCopy}>
              <Text strong>关闭时最小化到托盘</Text>
              <span className={styles.description}>关闭主窗口时继续保持挂件与映射运行</span>
            </div>
            {minimizeLoading ? (
              <Spin size="small" />
            ) : (
              <Switch
                checked={minimizeToTray}
                onChange={(value) => void changeMinimize(value)}
              />
            )}
          </div>
        </div>
      </Card>

      <Card className={styles.surfaceCard} title="外观">
        <RadioGroup
          type="button"
          value={mode}
          onChange={(event) => setMode(event.target.value as ThemeMode)}
          aria-label="主题模式"
        >
          <Radio value="light">浅色</Radio>
          <Radio value="dark">深色</Radio>
          <Radio value="system">跟随系统</Radio>
        </RadioGroup>
      </Card>

      <Card className={styles.surfaceCard} title="更新与关于">
        <div className={styles.settingsGroup}>
          <div className={styles.settingRow}>
            <div className={styles.settingCopy}>
              <Text strong>DockMapper {version}</Text>
              <span className={styles.description}>Tauri 2 + React · Windows 10/11 x64</span>
            </div>
            <Button type="tertiary" onClick={() => void openUrl(REPOSITORY_URL)}>
              GitHub
            </Button>
          </div>
          <div className={styles.settingRow}>
            <div className={styles.settingCopy}>
              <Text strong>软件更新</Text>
              <span className={styles.description}>从签名的 GitHub Release 检查更新</span>
            </div>
            <Button
              icon={<IconRefresh />}
              loading={checking}
              onClick={() => void checkForUpdate()}
            >
              检查更新
            </Button>
          </div>
        </div>
      </Card>

      <Banner
        type="info"
        closeIcon={null}
        title="管理员权限说明"
        description="仅在需要映射高权限窗口时使用管理员模式；开机自启默认使用当前用户权限。"
      />
    </div>
  );
}
