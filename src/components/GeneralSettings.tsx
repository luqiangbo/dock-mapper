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
import { Alert, App as AntApp, Button, Card, ColorPicker, Spin, Switch, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useTheme } from "../ThemeContext";
import styles from "./components.module.scss";

const { Text } = Typography;
const REPOSITORY_URL = "https://github.com/luqiangbo/dock-mapper";

export default function GeneralSettings() {
  const [autoStart, setAutoStart] = useState(false);
  const [autoStartLoading, setAutoStartLoading] = useState(true);
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [minimizeLoading, setMinimizeLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false);
  const [version, setVersion] = useState("—");
  const { accentColor, setAccentColor } = useTheme();
  const { modal, notification } = AntApp.useApp();

  useEffect(() => {
    void isAutostartEnabled()
      .then(setAutoStart)
      .catch((error) =>
        notification.error({ message: "读取开机启动状态失败", description: String(error) }),
      )
      .finally(() => setAutoStartLoading(false));
    void invoke<boolean>("get_minimize_to_tray")
      .then(setMinimizeToTray)
      .catch((error) =>
        notification.error({ message: "读取托盘设置失败", description: String(error) }),
      )
      .finally(() => setMinimizeLoading(false));
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion("未知"));
  }, [notification]);

  const changeAutostart = useCallback(async (checked: boolean) => {
    setAutoStartLoading(true);
    try {
      if (checked) await enableAutostart();
      else await disableAutostart();
      setAutoStart(checked);
      notification.success({ message: checked ? "开机自启已开启" : "开机自启已关闭" });
    } catch (error) {
      notification.error({ message: "操作失败", description: String(error) });
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
      notification.error({ message: "操作失败", description: String(error) });
    } finally {
      setMinimizeLoading(false);
    }
  }, []);

  const checkForUpdate = async () => {
    setChecking(true);
    try {
      const update = await check();
      if (!update) {
        notification.success({ message: "当前已是最新版本" });
        return;
      }
      modal.confirm({
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
      notification.error({ message: "检查更新失败", description: String(error) });
    } finally {
      setChecking(false);
    }
  };

  const exportDiagnostics = async () => {
    setExportingDiagnostics(true);
    try {
      const path = await invoke<string | null>("export_diagnostics");
      if (path) notification.success({ message: "诊断信息已导出", description: path });
    } catch (error) {
      notification.error({ message: "导出诊断信息失败", description: String(error) });
    } finally {
      setExportingDiagnostics(false);
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
              <Switch checked={minimizeToTray} onChange={(value) => void changeMinimize(value)} />
            )}
          </div>
          <div className={styles.settingRow}>
            <div className={styles.settingCopy}>
              <Text strong>诊断信息</Text>
              <span className={styles.description}>
                导出脱敏配置和最近日志，不包含截图、OCR 文本或完整文件路径。
              </span>
            </div>
            <Button loading={exportingDiagnostics} onClick={() => void exportDiagnostics()}>
              导出诊断信息
            </Button>
          </div>
        </div>
      </Card>

      <Card className={styles.surfaceCard} title="主题">
        <div className={styles.settingsGroup}>
          <div className={styles.settingRow}>
            <div className={styles.settingCopy}>
              <Text strong>主题色</Text>
              <span className={styles.description}>自定义按钮、选中状态和交互反馈的强调色</span>
            </div>
            <ColorPicker
              value={accentColor}
              showText
              onChangeComplete={(color) => setAccentColor(color.toHexString())}
            />
          </div>
        </div>
      </Card>

      <Card className={styles.surfaceCard} title="更新与关于">
        <div className={styles.settingsGroup}>
          <div className={styles.settingRow}>
            <div className={styles.settingCopy}>
              <Text strong>DockMapper {version}</Text>
              <span className={styles.description}>Tauri 2 + React · Windows 11 x64</span>
            </div>
            <Button onClick={() => void openUrl(REPOSITORY_URL)}>GitHub</Button>
          </div>
          <div className={styles.settingRow}>
            <div className={styles.settingCopy}>
              <Text strong>软件更新</Text>
              <span className={styles.description}>从签名的 GitHub Release 检查更新</span>
            </div>
            <Button
              icon={<ReloadOutlined />}
              loading={checking}
              onClick={() => void checkForUpdate()}
            >
              检查更新
            </Button>
          </div>
        </div>
      </Card>

      <Alert
        type="info"
        showIcon
        message="管理员权限说明"
        description="仅在需要映射高权限窗口时使用管理员模式；开机自启默认使用当前用户权限。"
      />
    </div>
  );
}
