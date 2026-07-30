import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Card,
  Notification,
  Radio,
  RadioGroup,
  Slider,
  Spin,
  Typography,
} from "@douyinfe/semi-ui";
import type { MemoryScheme, WidgetConfig } from "../types";
import styles from "./components.module.css";

const { Text, Title } = Typography;

const SCHEME_LABELS: Record<MemoryScheme, string> = {
  capsule: "胶囊呼吸灯",
  ring: "环形进度",
  gauge: "微型刻度",
};

export default function WidgetSettings() {
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void invoke<WidgetConfig>("get_widget_config")
      .then(setConfig)
      .catch((error) => Notification.error({ content: `加载挂件配置失败：${error}` }));
  }, []);

  const updateConfig = async (next: WidgetConfig) => {
    setSaving(true);
    try {
      const saved = await invoke<WidgetConfig>("update_widget_config", { config: next });
      setConfig(saved);
    } catch (error) {
      Notification.error({ content: `同步失败：${error}` });
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return <Spin />;
  }

  return (
    <div className={styles.page}>
      <Card className={styles.glassCard}>
        <div className={styles.sectionHeader}>
          <Title heading={6}>实时预览</Title>
          <Text type="secondary">{SCHEME_LABELS[config.memory_scheme]}</Text>
        </div>
        <div className={styles.preview}>
          <div className={styles.previewCapsule}>
            <span aria-hidden="true">↑ 2.4 K/s</span>
            <span aria-hidden="true">↓ 18.6 K/s</span>
            <span aria-label="内存占用 46%">RAM 46%</span>
          </div>
        </div>
      </Card>

      <Card className={styles.surfaceCard}>
        <div className={styles.settingsGroup}>
          <div className={styles.settingRow}>
            <div className={styles.settingCopy}>
              <Text strong>内存显示方案</Text>
              <span className={styles.description}>切换后任务栏挂件即时重绘</span>
            </div>
            <RadioGroup
              type="button"
              value={config.memory_scheme}
              disabled={saving}
              onChange={(event) => {
                void updateConfig({
                  ...config,
                  memory_scheme: event.target.value as MemoryScheme,
                });
              }}
              aria-label="内存显示方案"
            >
              <Radio value="capsule">胶囊</Radio>
              <Radio value="ring">环形</Radio>
              <Radio value="gauge">刻度</Radio>
            </RadioGroup>
          </div>

          <div className={styles.settingRow}>
            <div className={styles.settingCopy}>
              <Text strong>网速刷新间隔</Text>
              <span className={styles.description}>
                当前每 {config.refresh_interval_secs} 秒采样一次
              </span>
            </div>
            <Slider
              aria-label="网速刷新间隔"
              step={1}
              min={1}
              max={5}
              value={config.refresh_interval_secs}
              disabled={saving}
              marks={{ 1: "1s", 3: "3s", 5: "5s" }}
              onChange={(value) => {
                if (typeof value === "number") {
                  setConfig({ ...config, refresh_interval_secs: value });
                }
              }}
              onAfterChange={(value) => {
                if (typeof value === "number") {
                  void updateConfig({ ...config, refresh_interval_secs: value });
                }
              }}
            />
          </div>
        </div>
      </Card>
    </div>
  );
}
