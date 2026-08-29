import { useEffect, useState } from "react";
import { App as AntApp, Card, InputNumber, Select, Spin, Typography } from "antd";
import type { WidgetConfig } from "../types";
import styles from "./components.module.scss";
import { errorMessage, widgetApi } from "../api/commands";

const { Text } = Typography;

export default function WidgetSettings() {
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [interfaces, setInterfaces] = useState<string[]>([]);
  const { notification } = AntApp.useApp();

  useEffect(() => {
    void widgetApi
      .config()
      .then(setConfig)
      .catch((error) =>
        notification.error({ message: "加载挂件配置失败", description: errorMessage(error) }),
      );
    const refreshInterfaces = () =>
      widgetApi.networkInterfaces().then(setInterfaces).catch(() => setInterfaces([]));
    void refreshInterfaces();
    const timer = window.setInterval(() => void refreshInterfaces(), 30_000);
    return () => window.clearInterval(timer);
  }, [notification]);

  const updateConfig = async (next: WidgetConfig) => {
    setSaving(true);
    try {
      const saved = await widgetApi.update(next);
      setConfig(saved);
    } catch (error) {
      notification.error({ message: "同步失败", description: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return <Spin />;
  }

  return (
    <div className={styles.page}>
      <Card className={styles.surfaceCard}>
        <div className={styles.settingsGroup}>
          <div className={styles.settingRow}>
            <div className={styles.settingCopy}>
              <Text strong>内存显示样式</Text>
              <span className={styles.description}>选择任务栏中的内存占用展示方式</span>
            </div>
            <Select
              value={config.memory_scheme}
              disabled={saving}
              style={{ width: 140 }}
              options={[
                { value: "capsule", label: "胶囊" },
                { value: "ring", label: "圆环" },
                { value: "gauge", label: "刻度" },
              ]}
              onChange={(memory_scheme) => void updateConfig({ ...config, memory_scheme })}
            />
          </div>
          <div className={styles.settingRow}>
            <div className={styles.settingCopy}>
              <Text strong>网络接口</Text>
              <span className={styles.description}>
                {config.network_interface && !interfaces.includes(config.network_interface)
                  ? "所选网卡当前不可用；恢复连接后会自动继续采样"
                  : "自动模式会忽略常见虚拟和回环网卡"}
              </span>
            </div>
            <Select
              value={config.network_interface ?? ""}
              disabled={saving}
              style={{ width: 220 }}
              options={[
                { value: "", label: "自动选择" },
                ...interfaces.map((value) => ({ value, label: value })),
              ]}
              onChange={(value) =>
                void updateConfig({ ...config, network_interface: value || null })
              }
            />
          </div>
          <div className={styles.settingRow}>
            <div className={styles.settingCopy}>
              <Text strong>网速刷新间隔</Text>
              <span className={styles.description}>
                当前每 {config.refresh_interval_secs} 秒采样一次
              </span>
            </div>
            <InputNumber
              aria-label="网速刷新间隔"
              step={1}
              min={1}
              max={5}
              value={config.refresh_interval_secs}
              disabled={saving}
              addonAfter="秒"
              onChange={(value) => {
                if (typeof value === "number") {
                  setConfig({ ...config, refresh_interval_secs: value });
                }
              }}
              onBlur={() => void updateConfig(config)}
              onPressEnter={() => void updateConfig(config)}
            />
          </div>
        </div>
      </Card>
    </div>
  );
}
