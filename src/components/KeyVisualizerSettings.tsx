import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Alert, Button, Card, Slider, Spin, Switch, Tag, Typography, message } from "antd";
import { EyeInvisibleOutlined, EyeOutlined } from "@ant-design/icons";
import { errorMessage, keyVisualizerApi, MAIN_EVENTS } from "../api/commands";
import type { KeyVisualizerConfig, KeyVisualizerStatus } from "../types";
import { keyVisualizerToggleLabel } from "./keyVisualizerEntries";
import styles from "./components.module.scss";

const { Text, Title } = Typography;

function KeyPreview({ config }: { config: KeyVisualizerConfig }) {
  return (
    <div className={styles.keyVisualizerPreview} style={{ fontSize: config.font_size, opacity: config.text_opacity / 100 }}>
      <span>Ctrl</span><b>+</b><span>Shift</span><b>+</b><span>S</span>
      <em>×2</em>
    </div>
  );
}

export default function KeyVisualizerSettings() {
  const [config, setConfig] = useState<KeyVisualizerConfig | null>(null);
  const [status, setStatus] = useState<KeyVisualizerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextConfig, nextStatus] = await Promise.all([
        keyVisualizerApi.config(),
        keyVisualizerApi.status(),
      ]);
      setConfig(nextConfig);
      setStatus(nextStatus);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<KeyVisualizerConfig>(MAIN_EVENTS.keyVisualizerConfigChanged, ({ payload }) => setConfig(payload))
      .then((off) => disposed ? off() : (unlisten = off));
    return () => { disposed = true; unlisten?.(); };
  }, []);

  const save = useCallback(async (next: KeyVisualizerConfig) => {
    if (!config || saving) return;
    const previous = config;
    setConfig(next);
    setSaving(true);
    try {
      const saved = await keyVisualizerApi.update(next);
      setConfig(saved);
      setStatus(await keyVisualizerApi.status());
    } catch (error) {
      setConfig(previous);
      message.error(`按键文本设置未保存：${errorMessage(error)}`);
      setStatus(await keyVisualizerApi.status().catch(() => status));
    } finally {
      setSaving(false);
    }
  }, [config, saving, status]);

  if (loading) return <div className={styles.centerState}><Spin tip="读取按键文本设置…" /></div>;
  if (loadError || !config) {
    return <Alert type="error" showIcon message="按键文本设置读取失败" description={loadError} action={<Button onClick={() => void load()}>重试</Button>} />;
  }

  const toggle = (field: keyof KeyVisualizerConfig, checked: boolean) =>
    void save({ ...config, [field]: checked });

  return (
    <div className={styles.settingsStack}>
      <Card className={styles.glassCard} bordered={false}>
        <div className={styles.sectionHeader}>
          <div>
            <Title level={4}>按键文本</Title>
            <Text type="secondary">只显示键帽名称，不解析输入内容，也不会记录或上传。</Text>
          </div>
          <div className={styles.keyVisualizerStatus}>
            {saving && <Tag color="processing">正在同步</Tag>}
            <Tag color={status?.listening ? "success" : config.enabled ? "error" : "default"}>
              {status?.listening ? "原生监听中" : config.enabled ? "监听异常" : "已停用"}
            </Tag>
            <Button
              type={config.enabled ? "default" : "primary"}
              icon={config.enabled ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              loading={saving}
              disabled={saving}
              onClick={() => toggle("enabled", !config.enabled)}
            >
              {keyVisualizerToggleLabel(config.enabled)}
            </Button>
          </div>
        </div>
        {status?.error && (
          <Alert
            className={styles.inlineAlert}
            type="error"
            showIcon
            message="原生监听启动失败"
            description={status.error}
            action={<Button size="small" onClick={async () => {
              try { setStatus(await keyVisualizerApi.retry()); }
              catch (error) { message.error(errorMessage(error)); }
            }}>重试</Button>}
          />
        )}
        <div className={styles.keyVisualizerStage} style={{ transform: `scale(${config.scale_percent / 100})` }}>
          <KeyPreview config={config} />
        </div>
      </Card>

      <Card className={styles.glassCard} bordered={false} title="展示内容">
        <div className={styles.keyFilterGrid}>
          {([
            ["show_modifiers", "修饰键", "单独按下的 Ctrl、Shift、Alt、Win"],
            ["show_combinations", "组合键", "例如 Ctrl + Shift + S"],
            ["show_characters", "字符键", "字母、数字和符号键"],
            ["show_other", "其他键", "Enter、方向键、功能键等"],
          ] as const).map(([field, label, description]) => (
            <label className={styles.keyFilterItem} key={field}>
              <span><Text strong>{label}</Text><Text type="secondary">{description}</Text></span>
              <Switch checked={config[field]} disabled={saving} onChange={(value) => toggle(field, value)} />
            </label>
          ))}
        </div>
      </Card>

      <Card className={styles.glassCard} bordered={false} title="显示与交互">
        <div className={styles.visualizerControl}>
          <div><Text strong>字号</Text><Text type="secondary">{config.font_size}px</Text></div>
          <Slider disabled={saving} min={16} max={48} value={config.font_size} onChange={(value) => setConfig({ ...config, font_size: value })} onChangeComplete={(value) => void save({ ...config, font_size: value })} />
        </div>
        <div className={styles.visualizerControl}>
          <div><Text strong>整体缩放</Text><Text type="secondary">{config.scale_percent}%</Text></div>
          <Slider disabled={saving} min={75} max={200} step={5} value={config.scale_percent} onChange={(value) => setConfig({ ...config, scale_percent: value })} onChangeComplete={(value) => void save({ ...config, scale_percent: value })} />
        </div>
        <div className={styles.visualizerControl}>
          <div><Text strong>文本透明度</Text><Text type="secondary">{config.text_opacity}%</Text></div>
          <Slider disabled={saving} min={20} max={100} step={5} value={config.text_opacity} onChange={(value) => setConfig({ ...config, text_opacity: value })} onChangeComplete={(value) => void save({ ...config, text_opacity: value })} />
        </div>
        <Text type="secondary">悬浮窗固定在主显示器工作区左下角，并始终保持鼠标穿透。</Text>
      </Card>
    </div>
  );
}
