import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Form,
  Grid,
  InputNumber,
  Row,
  Spin,
  Switch,
  Tag,
  Typography,
} from "antd";
import { AimOutlined, UndoOutlined } from "@ant-design/icons";
import { errorMessage, keyVisualizerApi, MAIN_EVENTS } from "../api/commands";
import type {
  KeyVisualizerConfig,
  KeyVisualizerEffectsStatus,
  KeyVisualizerStatus,
} from "../types";
import styles from "./components.module.scss";
import { useQueuedAutosave } from "../hooks/useQueuedAutosave";

const { Text, Title } = Typography;

const CONTENT_FIELDS: Array<{
  name: keyof Pick<
    KeyVisualizerConfig,
    | "show_modifiers"
    | "show_combinations"
    | "show_characters"
    | "show_other"
    | "clicks"
    | "highlight"
    | "lock_keys"
  >;
  label: string;
  description: string;
}> = [
  { name: "show_combinations", label: "组合键", description: "例如 Ctrl + Shift + S" },
  { name: "show_modifiers", label: "修饰键", description: "单独按下 Ctrl、Shift、Alt、Win" },
  {
    name: "show_characters",
    label: "字符键",
    description: "连续合并为随机 Emoji，不显示真实输入内容",
  },
  { name: "show_other", label: "其他按键", description: "Enter、方向键和功能键" },
  { name: "clicks", label: "鼠标点击", description: "以不同颜色标记左、中、右键" },
  { name: "highlight", label: "鼠标高亮", description: "跟随光圈和页内定位动画" },
  { name: "lock_keys", label: "锁定键", description: "显示 CapsLock 和 NumLock 状态" },
];

function hasVisibleContent(config: KeyVisualizerConfig): boolean {
  return CONTENT_FIELDS.some(({ name }) => config[name]);
}

function hasValidStyle(config: KeyVisualizerConfig): boolean {
  return (
    Number.isFinite(config.font_size) &&
    config.font_size >= 16 &&
    config.font_size <= 48 &&
    Number.isFinite(config.scale_percent) &&
    config.scale_percent >= 75 &&
    config.scale_percent <= 200 &&
    Number.isFinite(config.text_opacity) &&
    config.text_opacity >= 20 &&
    config.text_opacity <= 100
  );
}

function statusDisplay(status: KeyVisualizerStatus | null, enabled: boolean) {
  if (status?.error) return { color: "error", label: "运行异常" } as const;
  if (status?.suspended) return { color: "warning", label: "截图中暂停" } as const;
  if (status?.phase === "starting") return { color: "processing", label: "正在启动" } as const;
  if (enabled && status?.listening) return { color: "success", label: "运行中" } as const;
  if (enabled) return { color: "processing", label: "等待监听" } as const;
  return { color: "default", label: "已关闭" } as const;
}

export default function KeyVisualizerSettings() {
  const screens = Grid.useBreakpoint();
  const { notification } = AntApp.useApp();
  const [form] = Form.useForm<KeyVisualizerConfig>();
  const [saved, setSaved] = useState<KeyVisualizerConfig | null>(null);
  const [status, setStatus] = useState<KeyVisualizerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const values = Form.useWatch([], form);
  const ownSaveInFlight = useRef(false);
  const statusRefreshRevision = useRef(0);
  const {
    schedule: queueSave,
    invalidate: invalidateSave,
    isCurrent: isSaveCurrent,
  } = useQueuedAutosave({
    delayMs: 450,
    save: async (next: KeyVisualizerConfig) => {
      ownSaveInFlight.current = true;
      try {
        return await keyVisualizerApi.update(next);
      } finally {
        ownSaveInFlight.current = false;
      }
    },
    onSavingChange: setSaving,
    onSuccess: async (config, { latest }) => {
      setSaved(config);
      if (!latest) return;
      form.setFieldsValue(config);
      setError(null);
      const request = ++statusRefreshRevision.current;
      try {
        const nextStatus = await keyVisualizerApi.status();
        if (request === statusRefreshRevision.current) setStatus(nextStatus);
      } catch (reason) {
        setError(`设置已保存，但刷新运行状态失败：${errorMessage(reason)}`);
      }
    },
    onError: (reason, { latest }) => {
      if (latest) setError(errorMessage(reason));
    },
  });

  const load = useCallback(async () => {
    const revision = invalidateSave();
    setLoading(true);
    setError(null);
    try {
      const [config, nextStatus] = await Promise.all([
        keyVisualizerApi.config(),
        keyVisualizerApi.status(),
      ]);
      if (!isSaveCurrent(revision)) return;
      setSaved(config);
      form.setFieldsValue(config);
      setStatus(nextStatus);
    } catch (reason) {
      if (isSaveCurrent(revision)) setError(errorMessage(reason));
    } finally {
      if (isSaveCurrent(revision)) setLoading(false);
    }
  }, [form, invalidateSave, isSaveCurrent]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let disposed = false;
    const offs: (() => void)[] = [];
    const subscribe = async () => {
      const offConfig = await listen<KeyVisualizerConfig>(
        MAIN_EVENTS.keyVisualizerConfigChanged,
        ({ payload }) => {
          if (disposed || ownSaveInFlight.current) return;
          invalidateSave();
          setSaved(payload);
          form.setFieldsValue(payload);
        },
      );
      if (disposed) offConfig();
      else offs.push(offConfig);

      const offStatus = await listen<KeyVisualizerEffectsStatus>(
        MAIN_EVENTS.keyVisualizerEffectsStatus,
        () => {
          const request = ++statusRefreshRevision.current;
          void keyVisualizerApi
            .status()
            .then((next) => {
              if (!disposed && request === statusRefreshRevision.current) setStatus(next);
            })
            .catch((reason) => {
              if (!disposed) setError(`刷新按键展示状态失败：${errorMessage(reason)}`);
            });
        },
      );
      if (disposed) offStatus();
      else offs.push(offStatus);
    };
    void subscribe().catch((reason) => {
      if (!disposed) setError(`监听按键展示状态失败：${errorMessage(reason)}`);
    });
    return () => {
      disposed = true;
      offs.forEach((off) => off());
    };
  }, [form, invalidateSave]);

  const dirty = useMemo(
    () => !!saved && !!values && JSON.stringify(values) !== JSON.stringify(saved),
    [saved, values],
  );

  const scheduleSave = useCallback(
    (next: KeyVisualizerConfig) => {
      invalidateSave();
      setError(null);
      form.setFields([{ name: "enabled", errors: [] }]);
      if (next.enabled && !hasVisibleContent(next)) {
        setSaving(false);
        form.setFields([{ name: "enabled", errors: ["启用时至少选择一种展示内容"] }]);
        setError("启用按键展示时至少选择一种展示内容");
        return;
      }
      if (!hasValidStyle(next)) {
        setSaving(false);
        setError("请填写有效的字号、缩放和透明度后再自动保存");
        return;
      }
      queueSave(next);
    },
    [form, invalidateSave, queueSave],
  );

  if (loading) {
    return (
      <div className={styles.centerState}>
        <Spin tip="读取按键展示设置…" />
      </div>
    );
  }

  if (!saved) {
    return (
      <Alert
        type="error"
        showIcon
        message="按键展示设置读取失败"
        description={error}
        action={<Button onClick={() => void load()}>重试</Button>}
      />
    );
  }

  const retry = async () => {
    setSaving(true);
    setError(null);
    try {
      setStatus(await keyVisualizerApi.retry());
      notification.success({ message: "按键展示已重新启动" });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const locate = async () => {
    setError(null);
    try {
      await keyVisualizerApi.locate();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const display = statusDisplay(status, saved.enabled);
  const visibleError = error ?? status?.error ?? null;

  return (
    <div className={styles.page}>
      {visibleError && (
        <Alert
          type="error"
          showIcon
          message="操作未完成"
          description={visibleError}
          action={status?.error ? <Button onClick={() => void retry()}>重试</Button> : undefined}
        />
      )}
      <Form
        form={form}
        layout="inline"
        className={`${styles.settingsForm} ${styles.visualizerForm}`}
        onValuesChange={(_, next) => scheduleSave(next)}
      >
        <Card className={styles.glassCard} bordered={false}>
          <div className={styles.visualizerHeader}>
            <div>
              <Title level={4}>按键展示</Title>
              <Text type="secondary">在屏幕上展示按键，并按需开启鼠标和锁定键辅助效果。</Text>
            </div>
            <div className={styles.visualizerHeaderActions}>
              <Tag color={display.color}>{display.label}</Tag>
              <Form.Item name="enabled" valuePropName="checked">
                <Switch checkedChildren="已开启" unCheckedChildren="已关闭" />
              </Form.Item>
            </div>
          </div>

          <section className={styles.visualizerSection}>
            <div className={styles.compactSectionTitle}>
              <Text strong>展示内容</Text>
              <Text type="secondary">至少选择一种内容</Text>
            </div>
            <Row gutter={[screens.lg ? 8 : 6, 8]}>
              {CONTENT_FIELDS.map((item) => (
                <Col xs={24} lg={12} key={item.name}>
                  <div className={styles.visualizerOption}>
                    <div>
                      <Text strong>{item.label}</Text>
                      <span className={styles.description}>{item.description}</span>
                    </div>
                    <Form.Item name={item.name} valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </div>
                </Col>
              ))}
            </Row>
          </section>

          <section className={styles.visualizerSection}>
            <div className={styles.compactSectionTitle}>
              <Text strong>显示样式</Text>
              <Text type="secondary">修改后自动同步到悬浮窗</Text>
            </div>
            <Row gutter={[8, 8]}>
              <Col xs={24} sm={12} lg={8}>
                <label className={styles.visualizerMetric}>
                  <span>字号</span>
                  <Form.Item
                    name="font_size"
                    rules={[{ required: true, type: "number", min: 16, max: 48 }]}
                  >
                    <InputNumber min={16} max={48} suffix="px" />
                  </Form.Item>
                </label>
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <label className={styles.visualizerMetric}>
                  <span>整体缩放</span>
                  <Form.Item
                    name="scale_percent"
                    rules={[{ required: true, type: "number", min: 75, max: 200 }]}
                  >
                    <InputNumber min={75} max={200} step={5} suffix="%" />
                  </Form.Item>
                </label>
              </Col>
              <Col xs={24} sm={12} lg={8}>
                <label className={styles.visualizerMetric}>
                  <span>文本透明度</span>
                  <Form.Item
                    name="text_opacity"
                    rules={[{ required: true, type: "number", min: 20, max: 100 }]}
                  >
                    <InputNumber min={20} max={100} step={5} suffix="%" />
                  </Form.Item>
                </label>
              </Col>
            </Row>
          </section>

          <div className={styles.visualizerFooter}>
            <div className={styles.visualizerFooterStatus}>
              {saving ? "正在自动保存…" : dirty ? "等待自动保存…" : "已自动保存"}
            </div>
            <div className={styles.visualizerFooterActions}>
              <Button
                icon={<AimOutlined />}
                disabled={
                  dirty ||
                  saving ||
                  !saved.enabled ||
                  !saved.highlight ||
                  status?.suspended ||
                  status?.phase === "starting"
                }
                onClick={() => void locate()}
              >
                定位鼠标
              </Button>
              <Button
                icon={<UndoOutlined />}
                disabled={!dirty || saving}
                onClick={() => {
                  invalidateSave();
                  form.setFieldsValue(saved);
                  form.setFields([{ name: "enabled", errors: [] }]);
                  setError(null);
                }}
              >
                撤销
              </Button>
            </div>
          </div>
        </Card>
      </Form>
    </div>
  );
}
