import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { App as AntApp, Button, Card, InputNumber, Segmented, Select, Space, Spin, Switch, Table, Tag, Typography } from "antd";
import type { SysStatus, WidgetConfig, WidgetMetricConfig } from "../types";
import styles from "./components.module.scss";
import { errorMessage, MAIN_EVENTS, widgetApi } from "../api/commands";

const { Text } = Typography;
const METRIC_LABELS = {
  network: "网速",
  cpu: "CPU",
  memory: "内存",
  battery: "电池",
} as const;
const USAGE_SCHEME_OPTIONS: Array<{
  value: WidgetMetricConfig["usage_scheme"];
  label: string;
}> = [
  { value: "capsule", label: "胶囊" },
  { value: "ring", label: "圆环" },
  { value: "gauge", label: "刻度" },
];

type WidgetMetricRow = WidgetMetricConfig & {
  index: number;
  visibleIndex: number;
  lastEnabled: boolean;
};

export default function WidgetSettings() {
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [interfaces, setInterfaces] = useState<string[]>([]);
  const [batteryAvailable, setBatteryAvailable] = useState<boolean | null>(null);
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

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<SysStatus>(MAIN_EVENTS.systemStatus, (event) => {
      setBatteryAvailable(event.payload.battery !== null && event.payload.battery !== undefined);
    })
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch((error) =>
        notification.warning({
          message: "设备能力检测不可用",
          description: errorMessage(error),
        }),
      );
    return () => {
      disposed = true;
      unlisten?.();
    };
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

  const updateMetric = (index: number, change: Partial<WidgetMetricConfig>) => {
    const metrics = config.metrics.map((metric, itemIndex) =>
      itemIndex === index ? { ...metric, ...change } : metric,
    );
    void updateConfig({
      ...config,
      metrics,
      // `memory_scheme` remains in the persisted schema for 1.0.5 clients.
      // Keep it in sync so normalisation never overwrites the new selector.
      memory_scheme:
        config.metrics[index].kind === "memory" && change.usage_scheme
          ? change.usage_scheme
          : config.memory_scheme,
    });
  };
  const visibleMetricIndexes = config.metrics.flatMap((metric, index) =>
    metric.kind === "battery" && batteryAvailable === false ? [] : [index],
  );
  const visibleEnabledCount = visibleMetricIndexes.filter((index) => config.metrics[index].enabled).length;
  const moveMetric = (index: number, direction: -1 | 1) => {
    const visibleIndex = visibleMetricIndexes.indexOf(index);
    const targetVisibleIndex = visibleIndex + direction;
    if (targetVisibleIndex < 0 || targetVisibleIndex >= visibleMetricIndexes.length) return;
    const target = visibleMetricIndexes[targetVisibleIndex];
    const metrics = [...config.metrics];
    [metrics[index], metrics[target]] = [metrics[target], metrics[index]];
    void updateConfig({ ...config, metrics });
  };
  const metricRows: WidgetMetricRow[] = visibleMetricIndexes.map((index, visibleIndex) => {
    const metric = config.metrics[index];
    return {
      ...metric,
      index,
      visibleIndex,
      lastEnabled: metric.enabled && visibleEnabledCount === 1,
    };
  });
  const metricColumns = [
    {
      title: "启用",
      dataIndex: "enabled",
      width: 76,
      render: (_: boolean, metric: WidgetMetricRow) => (
        <Switch
          aria-label={`${METRIC_LABELS[metric.kind]} 指标开关`}
          checked={metric.enabled}
          disabled={saving || metric.lastEnabled}
          onChange={(enabled) => updateMetric(metric.index, { enabled })}
        />
      ),
    },
    {
      title: "指标",
      dataIndex: "kind",
      width: 112,
      render: (kind: WidgetMetricRow["kind"]) => METRIC_LABELS[kind],
    },
    {
      title: "展示样式",
      dataIndex: "usage_scheme",
      render: (_: WidgetMetricRow["usage_scheme"], metric: WidgetMetricRow) =>
        metric.kind === "network" ? (
          <Text type="secondary">双行速率</Text>
        ) : (
          <Segmented
            size="small"
            value={metric.usage_scheme}
            disabled={saving || !metric.enabled}
            options={USAGE_SCHEME_OPTIONS}
            onChange={(usage_scheme) =>
              updateMetric(metric.index, {
                usage_scheme: usage_scheme as WidgetMetricConfig["usage_scheme"],
              })
            }
          />
        ),
    },
    {
      title: "顺序",
      width: 148,
      render: (_: unknown, metric: WidgetMetricRow) => (
        <Space size={4}>
          <Button
            size="small"
            disabled={saving || metric.visibleIndex === 0}
            onClick={() => moveMetric(metric.index, -1)}
          >
            上移
          </Button>
          <Button
            size="small"
            disabled={saving || metric.visibleIndex === metricRows.length - 1}
            onClick={() => moveMetric(metric.index, 1)}
          >
            下移
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <Card className={styles.surfaceCard}>
        <div className={styles.settingsGroup}>
          <div className={styles.toolbar}>
            <div>
              <Text strong>任务栏指标</Text>
              <span className={styles.description}>
                至少保留一个指标；宽度会按实际内容自动调整。桌面机检测到无电池时不显示电池项。
              </span>
            </div>
          </div>
          <Table
            className={styles.table}
            rowKey="kind"
            size="small"
            columns={metricColumns}
            dataSource={metricRows}
            pagination={false}
            loading={saving}
            locale={{ emptyText: <Text type="secondary">暂无可配置指标</Text> }}
          />
          {batteryAvailable === false && <Tag color="default">当前设备未检测到电池</Tag>}
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
