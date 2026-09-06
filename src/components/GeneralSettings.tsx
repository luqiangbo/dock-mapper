import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { Alert, App as AntApp, Button, Card, ColorPicker, Form, Spin, Switch, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { useTheme } from "../ThemeContext";
import styles from "./components.module.scss";
import { errorMessage, generalSettingsApi } from "../api/commands";

const { Text } = Typography;
const REPOSITORY_URL = "https://github.com/luqiangbo/dock-mapper";

export default function GeneralSettings() {
  const [form] = Form.useForm<{ autoStart: boolean; minimizeToTray: boolean; accentColor: string }>();
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
      .then((value) => { setAutoStart(value); form.setFieldValue("autoStart", value); })
      .catch((error) =>
        notification.error({ message: "读取开机启动状态失败", description: errorMessage(error) }),
      )
      .finally(() => setAutoStartLoading(false));
    void generalSettingsApi
      .minimizeToTray()
      .then((value) => { setMinimizeToTray(value); form.setFieldValue("minimizeToTray", value); })
      .catch((error) =>
        notification.error({ message: "读取托盘设置失败", description: errorMessage(error) }),
      )
      .finally(() => setMinimizeLoading(false));
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion("未知"));
    form.setFieldValue("accentColor", accentColor);
  }, [accentColor, form, notification]);

  const changeAutostart = useCallback(async (checked: boolean) => {
    setAutoStartLoading(true);
    try {
      if (checked) await enableAutostart();
      else await disableAutostart();
      setAutoStart(checked);
      form.setFieldValue("autoStart", checked);
      notification.success({ message: checked ? "开机自启已开启" : "开机自启已关闭" });
    } catch (error) {
      form.setFieldValue("autoStart", autoStart);
      notification.error({ message: "操作失败", description: errorMessage(error) });
    } finally {
      setAutoStartLoading(false);
    }
  }, []);

  const changeMinimize = useCallback(async (checked: boolean) => {
    setMinimizeLoading(true);
    try {
      await generalSettingsApi.setMinimizeToTray(checked);
      setMinimizeToTray(checked);
      form.setFieldValue("minimizeToTray", checked);
    } catch (error) {
      form.setFieldValue("minimizeToTray", minimizeToTray);
      notification.error({ message: "操作失败", description: errorMessage(error) });
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
      notification.error({ message: "检查更新失败", description: errorMessage(error) });
    } finally {
      setChecking(false);
    }
  };

  const exportDiagnostics = async () => {
    setExportingDiagnostics(true);
    try {
      const path = await generalSettingsApi.exportDiagnostics();
      if (path) notification.success({ message: "诊断信息已导出", description: path });
    } catch (error) {
      notification.error({ message: "导出诊断信息失败", description: errorMessage(error) });
    } finally {
      setExportingDiagnostics(false);
    }
  };

  return (
    <div className={styles.page}>
      <Form form={form} layout="vertical" className={styles.settingsForm}>
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
              <Form.Item noStyle name="autoStart" valuePropName="checked"><Switch onChange={(value) => void changeAutostart(value)} /></Form.Item>
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
              <Form.Item noStyle name="minimizeToTray" valuePropName="checked"><Switch onChange={(value) => void changeMinimize(value)} /></Form.Item>
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
            <Form.Item noStyle name="accentColor"><ColorPicker
              value={accentColor}
              showText
              onChangeComplete={(color) => setAccentColor(color.toHexString())}
            /></Form.Item>
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
        description="应用或恢复系统按键映射时会按需请求 Windows UAC；主应用始终保持普通用户权限。"
      />
      </Form>
    </div>
  );
}
