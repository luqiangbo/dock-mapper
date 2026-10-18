import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Form,
  Grid,
  Input,
  Popconfirm,
  Row,
  Select,
  Spin,
  Tag,
  Typography,
} from "antd";

import type { SpeedUnit, SysStatus, WidgetConfig } from "../types";
import { WidgetLayoutControls } from "./WidgetLayoutControls";
import type { WidgetLayoutBudget } from "../api/screenshotTypes";
import { acceptWidgetBudget } from "../widgetPresentation";
import { invokeCommand } from "../api/ipc";
import styles from "./components.module.scss";
import { errorMessage, MAIN_EVENTS, widgetApi } from "../api/commands";
import { useQueuedAutosave } from "../hooks/useQueuedAutosave";
import { usePageActive, usePageReadGuard, usePageRefresh } from "./PageActivity";
import { takeDetachedAutosaveError, waitForPendingAutosave } from "../hooks/queuedAutosave";
import { useTelemetryFreshness } from "../utils/telemetryFreshness";
import type { WidgetLayoutReport } from "../widgetLayout";
import { WidgetMetricList } from "./WidgetMetricList";
import { applyWidgetPreset, deleteWidgetPreset, saveCurrentWidgetPreset } from "./widgetPresets";

const { Text } = Typography;
const AUTO_SAVE_DELAY_MS = 400;
const METRIC_LABELS = {
  network: "网速",
  upload: "上传",
  download: "下载",
  cpu: "CPU",
  memory: "内存",
  battery: "电池",
} as const;
export default function WidgetSettings() {
  const active = usePageActive();
  const reads = usePageReadGuard();
  const loaded = useRef(false);
  const screens = Grid.useBreakpoint();
  const [form] = Form.useForm<WidgetConfig>();
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<WidgetConfig | null>(null);
  const [status, setStatus] = useState<SysStatus | null>(null);
  const [lastSampleAt, setLastSampleAt] = useState<number | null>(null);
  const freshness = useTelemetryFreshness(lastSampleAt, active);
  const [layoutReport, setLayoutReport] = useState<WidgetLayoutReport | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [nativeBudget, setNativeBudget] = useState<WidgetLayoutBudget | null>(null);
  const requestLayoutRef = useRef<(() => Promise<void>) | null>(null);
  const [presetName, setPresetName] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
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
    key: "widget-settings",
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
    onDetachedError: (error) =>
      notification.error({
        message: "挂件设置未保存",
        description: errorMessage(error),
      }),
  });

  const load = useCallback(async () => {
    const request = reads.begin();
    const revision = invalidateSave();
    if (!loaded.current) setLoading(true);
    setLoadError(null);
    try {
      await waitForPendingAutosave("widget-settings");
      const next = await widgetApi.config();
      if (!reads.isCurrent(request) || !isSaveCurrent(revision)) return;
      loaded.current = true;
      const pendingError = takeDetachedAutosaveError("widget-settings");
      if (pendingError) setSaveError(errorMessage(pendingError));
      setConfig(next);
      setSavedConfig(next);
      form.setFieldsValue(next);
    } catch (error) {
      if (reads.isCurrent(request) && isSaveCurrent(revision)) setLoadError(errorMessage(error));
    } finally {
      if (reads.isCurrent(request)) setLoading(false);
    }
  }, [form, invalidateSave, isSaveCurrent, reads]);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<SysStatus>(MAIN_EVENTS.systemStatus, (event) => {
      if (disposed) return;
      setStatus(event.payload);
      setLastSampleAt(Date.now());
    })
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch((error) => {
        if (!disposed)
          notification.warning({
            message: "系统采样暂不可用",
            description: errorMessage(error),
          });
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [notification, active]);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const cleanup: Array<() => void> = [];
    const applyBudget = (next: WidgetLayoutBudget) => {
      if (!disposed) {
        setNativeBudget((current) => (current ? acceptWidgetBudget(current, next) : next));
        setLayoutError(null);
      }
    };
    const requestLayout = async () => {
      const next = await invokeCommand("refresh_widget_position");
      applyBudget(next);
      await emit("widget-layout-request");
    };
    requestLayoutRef.current = requestLayout;
    void Promise.all(
      [
        listen<WidgetLayoutReport>("widget-layout-report", ({ payload }) => {
          if (!disposed)
            setLayoutReport((current) =>
              (payload.revision ?? 0) >= (current?.revision ?? 0) ? payload : current,
            );
        }),
        listen<WidgetLayoutBudget>("widget-layout-budget", ({ payload }) => applyBudget(payload)),
      ].map((registration) =>
        registration.then((off) => {
          if (disposed) off();
          else cleanup.push(off);
        }),
      ),
    )
      .then(() => {
        if (!disposed) return requestLayout();
      })
      .catch((error) => {
        if (!disposed) setLayoutError(errorMessage(error));
      });
    return () => {
      disposed = true;
      requestLayoutRef.current = null;
      cleanup.forEach((off) => off());
    };
  }, [active]);
  const dirty = useMemo(
    () => !!config && !!savedConfig && JSON.stringify(config) !== JSON.stringify(savedConfig),
    [config, savedConfig],
  );
  usePageRefresh(load, dirty || saving || !!saveError);

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

  const saveLabel = saveError
    ? "保存失败"
    : saving
      ? "正在自动保存…"
      : dirty
        ? "等待自动保存…"
        : "已自动保存";
  const currentPreset = config.presets.find((preset) => preset.name === selectedPreset);
  const savePreset = () => {
    const next = saveCurrentWidgetPreset(config, presetName);
    if (next === config) return;
    scheduleSave(next);
    setSelectedPreset(presetName.trim());
  };

  return (
    <Form form={form} layout="vertical" className={`${styles.page} ${styles.settingsForm}`}>
      {loadError && (
        <Alert
          type="warning"
          showIcon
          message="挂件设置刷新失败"
          description={loadError}
          action={
            <Button disabled={dirty || saving} onClick={() => void load()}>
              重试读取
            </Button>
          }
        />
      )}
      <Card
        className={styles.surfaceCard}
        title="任务栏挂件"
        extra={
          <Tag
            color={
              layoutError
                ? "error"
                : !nativeBudget
                  ? "processing"
                  : nativeBudget.error
                    ? "warning"
                    : nativeBudget.visible
                      ? "success"
                      : "warning"
            }
          >
            {layoutError
              ? "状态读取失败"
              : !nativeBudget
                ? "读取状态"
                : nativeBudget.error
                  ? nativeBudget.state === "probeFailed"
                    ? "任务栏暂不可用"
                    : "布局操作失败"
                  : nativeBudget.visible
                    ? "显示中"
                    : nativeBudget.state === "insufficientSpace"
                      ? "空间不足"
                      : nativeBudget.state === "probeFailed"
                        ? "任务栏暂不可用"
                        : "正在恢复"}
          </Tag>
        }
      >
        <div className={`${styles.settingsGroup} ${styles.widgetSettingsGroup}`}>
          <section className={styles.widgetStatusPane} aria-label="任务栏挂件运行状态">
            <Text type="secondary">
              在任务栏展示网速和资源数据；自由组合指标，直接在任务栏查看效果，修改后自动保存。
            </Text>
            <Text type="secondary">
              {freshness === "stale" ? "系统采样已过期。" : ""}
              {layoutError
                ? `挂件空间状态读取失败：${layoutError}。`
                : !nativeBudget
                  ? "正在读取任务栏可用空间…"
                  : nativeBudget.error
                    ? nativeBudget.error
                    : !nativeBudget.visible
                      ? (nativeBudget.error ??
                        (nativeBudget.state === "insufficientSpace"
                          ? "任务栏空间不足，空间稳定恢复后自动显示。"
                          : "正在确认任务栏可用空间…"))
                      : !layoutReport || layoutReport.revision !== nativeBudget.revision
                        ? "挂件已显示，正在同步指标布局…"
                        : layoutReport.hiddenKinds.length
                          ? `当前显示：${layoutReport.visibleKinds.map((kind) => METRIC_LABELS[kind]).join("、")}；空间不足已收起：${layoutReport.hiddenKinds.map((kind) => METRIC_LABELS[kind]).join("、")}。可将重要指标上移。`
                          : `当前全部显示${layoutReport.compact ? "（紧凑布局）" : ""}。`}
            </Text>
            {layoutError && (
              <Button
                size="small"
                onClick={() => {
                  setLayoutError(null);
                  void requestLayoutRef
                    .current?.()
                    .catch((error) => setLayoutError(errorMessage(error)));
                }}
              >
                重试读取空间状态
              </Button>
            )}
          </section>
          <div className={styles.configurationPane}>
            <WidgetLayoutControls
              value={config.layout}
              onChange={(layout) => scheduleSave({ ...config, layout })}
            />
            <WidgetMetricList
              metrics={config.metrics}
              batteryAvailable={status?.battery !== null}
              onChange={(metrics) =>
                scheduleSave({
                  ...config,
                  metrics,
                  memory_scheme:
                    metrics.find((metric) => metric.kind === "memory")?.usage_scheme ??
                    config.memory_scheme,
                })
              }
            />
            {freshness === "live" && status?.battery === null && (
              <Tag color="default">当前设备未检测到电池</Tag>
            )}
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
            <div className={styles.widgetOptionCard}>
              <div className={styles.settingCopy}>
                <Text strong>挂件布局预设</Text>
                <span className={styles.description}>
                  保存当前指标顺序、图标与展示样式、布局距离、采样间隔和网速单位，最多 8 组。
                </span>
              </div>
              <Row gutter={[8, 8]} align="middle">
                <Col>
                  <Input
                    aria-label="新预设名称"
                    value={presetName}
                    maxLength={24}
                    placeholder="预设名称…"
                    onChange={(event) => setPresetName(event.target.value)}
                  />
                </Col>
                <Col>
                  <Popconfirm
                    title="覆盖同名布局预设？"
                    disabled={!config.presets.some((preset) => preset.name === presetName.trim())}
                    onConfirm={savePreset}
                  >
                    <Button
                      disabled={
                        !presetName.trim() ||
                        (config.presets.length >= 8 &&
                          !config.presets.some((preset) => preset.name === presetName.trim()))
                      }
                      onClick={() => {
                        if (!config.presets.some((preset) => preset.name === presetName.trim()))
                          savePreset();
                      }}
                    >
                      {config.presets.some((preset) => preset.name === presetName.trim())
                        ? "更新预设"
                        : "保存当前布局"}
                    </Button>
                  </Popconfirm>
                </Col>
                <Col>
                  <Select
                    aria-label="选择布局预设"
                    style={{ minWidth: 140 }}
                    placeholder="选择预设"
                    value={selectedPreset}
                    onChange={setSelectedPreset}
                    options={config.presets.map((preset) => ({
                      value: preset.name,
                      label: preset.name,
                    }))}
                  />
                </Col>
                <Col>
                  <Button
                    disabled={!currentPreset}
                    onClick={() => {
                      const next = selectedPreset && applyWidgetPreset(config, selectedPreset);
                      if (next) scheduleSave(next);
                    }}
                  >
                    应用预设
                  </Button>
                </Col>
                <Col>
                  <Popconfirm
                    title="删除这个布局预设？"
                    onConfirm={() => {
                      if (!selectedPreset) return;
                      scheduleSave(deleteWidgetPreset(config, selectedPreset));
                      setSelectedPreset(null);
                    }}
                  >
                    <Button danger disabled={!currentPreset}>
                      删除预设
                    </Button>
                  </Popconfirm>
                </Col>
              </Row>
            </div>
            <Text type="secondary">
              {!config.presets.length
                ? "尚未保存布局预设，可为当前布局命名后保存。"
                : config.presets.length >= 8
                  ? "已保存 8 组预设；可覆盖同名预设或删除后再新增。"
                  : ""}
            </Text>
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
        </div>
      </Card>
    </Form>
  );
}
