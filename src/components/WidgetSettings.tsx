import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Form,
  Grid,
  Row,
  Select,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import { Battery, Cpu, MemoryStick } from "lucide-react";
import type {
  SpeedUnit,
  SysStatus,
  WidgetConfig,
  WidgetMetricConfig,
  WidgetMetricKind,
} from "../types";
import { formatSpeedParts } from "../utils/format";
import styles from "./components.module.scss";
import { errorMessage, MAIN_EVENTS, widgetApi } from "../api/commands";
import { useQueuedAutosave } from "../hooks/useQueuedAutosave";

const { Text } = Typography;
const AUTO_SAVE_DELAY_MS = 400;
const METRIC_LABELS = { network: "网速", cpu: "CPU", memory: "内存", battery: "电池" } as const;
const USAGE_SCHEME_OPTIONS: Array<{
  value: WidgetMetricConfig["usage_scheme"];
  label: string;
}> = [
  { value: "capsule", label: "紧凑" },
  { value: "ring", label: "圆环" },
  { value: "gauge", label: "刻度" },
];
const EMPTY_STATUS: SysStatus = {
  upload_speed: 0,
  download_speed: 0,
  memory_usage: 0,
  network_available: true,
};

type WidgetMetricRow = WidgetMetricConfig & {
  index: number;
  visibleIndex: number;
  lastEnabled: boolean;
};

function metricValue(kind: Exclude<WidgetMetricKind, "network">, status: SysStatus): number {
  if (kind === "cpu") return status.cpu_usage ?? 0;
  if (kind === "battery") return status.battery?.percentage ?? 0;
  return status.memory_usage;
}

function metricIcon(kind: Exclude<WidgetMetricKind, "network">): ReactNode {
  if (kind === "cpu") return <Cpu size={13} />;
  if (kind === "battery") return <Battery size={13} />;
  return <MemoryStick size={13} />;
}

function WidgetPreview({ config, status }: { config: WidgetConfig; status: SysStatus }) {
  const upload = status.network_available
    ? formatSpeedParts(status.upload_speed, config.speed_unit)
    : { value: "—", unit: "" };
  const download = status.network_available
    ? formatSpeedParts(status.download_speed, config.speed_unit)
    : { value: "—", unit: "" };
  const enabled = config.metrics.filter(
    (metric) => metric.enabled && (metric.kind !== "battery" || status.battery != null),
  );

  return (
    <div className={styles.widgetPreview} aria-label="任务栏挂件实时预览">
      {enabled.map((metric) => {
        if (metric.kind === "network") {
          return (
            <div className={styles.previewNetwork} key={metric.kind}>
              <span>↑</span>
              <b>{upload.value}</b>
              <small>{upload.unit}</small>
              <span>↓</span>
              <b>{download.value}</b>
              <small>{download.unit}</small>
            </div>
          );
        }
        const value = metricValue(metric.kind, status);
        if (metric.usage_scheme === "ring") {
          return (
            <div className={styles.previewRing} key={metric.kind}>
              {value.toFixed(0)}
            </div>
          );
        }
        if (metric.usage_scheme === "gauge") {
          return (
            <div className={styles.previewGauge} key={metric.kind}>
              <span>
                {[0, 1, 2, 3, 4].map((index) => (
                  <i key={index} data-active={index < Math.ceil(value / 20)} />
                ))}
              </span>
              <b>{value.toFixed(0)}%</b>
            </div>
          );
        }
        return (
          <div className={styles.previewCompact} key={metric.kind}>
            {metricIcon(metric.kind)}
            <b>{value.toFixed(0)}%</b>
          </div>
        );
      })}
    </div>
  );
}

export default function WidgetSettings() {
  const screens = Grid.useBreakpoint();
  const [form] = Form.useForm<WidgetConfig>();
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<WidgetConfig | null>(null);
  const [status, setStatus] = useState<SysStatus>(EMPTY_STATUS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { notification } = AntApp.useApp();
  const {
    schedule: queueSave,
    invalidate: invalidateSave,
    isCurrent: isSaveCurrent,
  } = useQueuedAutosave({
    delayMs: AUTO_SAVE_DELAY_MS,
    save: widgetApi.update,
    onSavingChange: setSaving,
    onSuccess: (next, { latest }) => {
      setSavedConfig(next);
      if (!latest) return;
      setConfig(next);
      form.setFieldsValue(next);
      setSaveError(null);
    },
    onError: (error, { latest }) => {
      if (latest) setSaveError(errorMessage(error));
    },
  });

  const load = useCallback(async () => {
    const revision = invalidateSave();
    setLoading(true);
    setLoadError(null);
    try {
      const next = await widgetApi.config();
      if (!isSaveCurrent(revision)) return;
      setConfig(next);
      setSavedConfig(next);
      form.setFieldsValue(next);
    } catch (error) {
      if (isSaveCurrent(revision)) setLoadError(errorMessage(error));
    } finally {
      if (isSaveCurrent(revision)) setLoading(false);
    }
  }, [form, invalidateSave, isSaveCurrent]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<SysStatus>(MAIN_EVENTS.systemStatus, (event) => setStatus(event.payload))
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch((error) =>
        notification.warning({
          message: "挂件预览暂不可用",
          description: errorMessage(error),
        }),
      );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [notification]);

  const dirty = useMemo(
    () => !!config && !!savedConfig && JSON.stringify(config) !== JSON.stringify(savedConfig),
    [config, savedConfig],
  );

  const scheduleSave = useCallback(
    (next: WidgetConfig, delay = AUTO_SAVE_DELAY_MS) => {
      setConfig(next);
      form.setFieldsValue(next);
      setSaveError(null);
      queueSave(next, delay);
    },
    [form, queueSave],
  );

  if (loading) {
    return (
      <div className={`${styles.page} ${styles.centerState}`}>
        <Spin tip="读取挂件设置…" />
      </div>
    );
  }

  if (!config || !savedConfig) {
    return (
      <div className={styles.page}>
        <Alert
          type="error"
          showIcon
          message="挂件设置读取失败"
          description={loadError}
          action={<Button onClick={() => void load()}>重试</Button>}
        />
      </div>
    );
  }

  const updateMetric = (index: number, change: Partial<WidgetMetricConfig>) => {
    const metrics = config.metrics.map((metric, itemIndex) =>
      itemIndex === index ? { ...metric, ...change } : metric,
    );
    scheduleSave({
      ...config,
      metrics,
      memory_scheme:
        config.metrics[index].kind === "memory" && change.usage_scheme
          ? change.usage_scheme
          : config.memory_scheme,
    });
  };
  const visibleMetricIndexes = config.metrics.flatMap((metric, index) =>
    metric.kind === "battery" && status.battery === null ? [] : [index],
  );
  const enabledCount = visibleMetricIndexes.filter((index) => config.metrics[index].enabled).length;
  const moveMetric = (index: number, direction: -1 | 1) => {
    const visibleIndex = visibleMetricIndexes.indexOf(index);
    const targetVisibleIndex = visibleIndex + direction;
    if (targetVisibleIndex < 0 || targetVisibleIndex >= visibleMetricIndexes.length) return;
    const target = visibleMetricIndexes[targetVisibleIndex];
    const metrics = [...config.metrics];
    [metrics[index], metrics[target]] = [metrics[target], metrics[index]];
    scheduleSave({ ...config, metrics });
  };
  const metricRows: WidgetMetricRow[] = visibleMetricIndexes.map((index, visibleIndex) => ({
    ...config.metrics[index],
    index,
    visibleIndex,
    lastEnabled: config.metrics[index].enabled && enabledCount === 1,
  }));
  const metricColumns = [
    {
      title: "启用",
      dataIndex: "enabled",
      width: 76,
      render: (_: boolean, metric: WidgetMetricRow) => (
        <Form.Item noStyle name={["metrics", metric.index, "enabled"]} valuePropName="checked">
          <Switch
            aria-label={`${METRIC_LABELS[metric.kind]} 指标开关`}
            disabled={metric.lastEnabled}
            onChange={(enabled) => updateMetric(metric.index, { enabled })}
          />
        </Form.Item>
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
          <Text type="secondary">双行固定槽位</Text>
        ) : (
          <Form.Item noStyle name={["metrics", metric.index, "usage_scheme"]}>
            <Select
              size="small"
              disabled={!metric.enabled}
              options={USAGE_SCHEME_OPTIONS}
              onChange={(usage_scheme) => updateMetric(metric.index, { usage_scheme })}
            />
          </Form.Item>
        ),
    },
    {
      title: "顺序",
      width: 148,
      render: (_: unknown, metric: WidgetMetricRow) => (
        <div className={styles.actionRow}>
          <Button
            size="small"
            disabled={metric.visibleIndex === 0}
            onClick={() => moveMetric(metric.index, -1)}
          >
            上移
          </Button>
          <Button
            size="small"
            disabled={metric.visibleIndex === metricRows.length - 1}
            onClick={() => moveMetric(metric.index, 1)}
          >
            下移
          </Button>
        </div>
      ),
    },
  ];
  const saveLabel = saveError
    ? "保存失败"
    : saving
      ? "正在自动保存…"
      : dirty
        ? "等待自动保存…"
        : "已自动保存";

  return (
    <Form form={form} layout="vertical" className={`${styles.page} ${styles.settingsForm}`}>
      <Card className={styles.surfaceCard}>
        <div className={`${styles.settingsGroup} ${styles.widgetSettingsGroup}`}>
          <div className={styles.widgetPreviewHeader}>
            <div>
              <Text strong>实时预览</Text>
              <span className={styles.description}>
                固定宽度槽位会阻止实时数值带动任务栏整体位移。
              </span>
            </div>
            <Tag
              color={saveError ? "error" : saving ? "processing" : dirty ? "warning" : "success"}
            >
              {saveLabel.replace("…", "")}
            </Tag>
          </div>
          <WidgetPreview config={config} status={status} />
          <Table
            className={styles.table}
            rowKey="kind"
            size={screens.lg ? "middle" : "small"}
            columns={metricColumns}
            dataSource={metricRows}
            pagination={false}
            scroll={{ x: 560 }}
            locale={{ emptyText: <Text type="secondary">暂无可配置指标</Text> }}
          />
          {status.battery === null && <Tag color="default">当前设备未检测到电池</Tag>}
          <Row gutter={[screens.lg ? 12 : 8, 8]}>
            <Col xs={24} md={12}>
              <div className={styles.widgetOptionCard}>
                <div className={styles.settingCopy}>
                  <Text strong>刷新间隔</Text>
                  <span className={styles.description}>控制网速和资源数据的采样频率</span>
                </div>
                <Form.Item noStyle name="refresh_interval_secs">
                  <Select
                    options={[1, 2, 3, 5].map((value) => ({ value, label: `${value} 秒` }))}
                    onChange={(refresh_interval_secs) =>
                      scheduleSave({ ...config, refresh_interval_secs })
                    }
                  />
                </Form.Item>
              </div>
            </Col>
            <Col xs={24} md={12}>
              <div className={styles.widgetOptionCard}>
                <div className={styles.settingCopy}>
                  <Text strong>网速单位</Text>
                  <span className={styles.description}>固定单位时数值不再跨单位切换</span>
                </div>
                <Form.Item noStyle name="speed_unit">
                  <Select
                    options={[
                      { value: "auto", label: "自动" },
                      { value: "kb", label: "KB/s" },
                      { value: "mb", label: "MB/s" },
                    ]}
                    onChange={(speed_unit) =>
                      scheduleSave({ ...config, speed_unit: speed_unit as SpeedUnit })
                    }
                  />
                </Form.Item>
              </div>
            </Col>
          </Row>
          {saveError && (
            <Alert
              type="error"
              showIcon
              message="挂件设置未保存"
              description={saveError}
              action={
                <Button size="small" onClick={() => scheduleSave(config, 0)}>
                  重试保存
                </Button>
              }
            />
          )}
          <div className={styles.autoSaveFooter}>
            <Text type="secondary">{saveLabel}</Text>
            <Button
              disabled={!dirty || saving}
              onClick={() => {
                invalidateSave();
                setConfig(savedConfig);
                form.setFieldsValue(savedConfig);
                setSaveError(null);
              }}
            >
              撤销修改
            </Button>
          </div>
        </div>
      </Card>
    </Form>
  );
}
