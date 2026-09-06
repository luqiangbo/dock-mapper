import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Alert, Button, Card, Form, Input, Select, Space, Spin, Switch, Tag, Typography, message } from "antd";
import { MAIN_EVENTS, errorMessage, presentationApi } from "../api/commands";
import type { PresentationConfig, PresentationStatus } from "../types";
import KeyVisualizerSettings from "./KeyVisualizerSettings";
import styles from "./components.module.scss";

type PresentationFormValues = Omit<PresentationConfig, "show_characters" | "show_modifiers"> & { key_inputs: string[] };
const toFormValues = (config: PresentationConfig): PresentationFormValues => ({ ...config, key_inputs: [config.show_characters && "characters", config.show_modifiers && "modifiers"].filter(Boolean) as string[] });
const toConfig = (values: PresentationFormValues): PresentationConfig => {
  const { key_inputs: keyInputs = [], ...config } = values;
  return { ...config, show_characters: keyInputs.includes("characters"), show_modifiers: keyInputs.includes("modifiers") };
};

export default function PresentationSettings() {
  const [form] = Form.useForm<PresentationFormValues>();
  const [status, setStatus] = useState<PresentationStatus | null>(null);
  const [saved, setSaved] = useState<PresentationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const values = Form.useWatch([], form);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const [config, nextStatus] = await Promise.all([presentationApi.config(), presentationApi.status()]); setSaved(config); form.setFieldsValue(toFormValues(config)); form.resetFields(); setStatus(nextStatus); }
    catch (reason) { setError(errorMessage(reason)); } finally { setLoading(false); }
  }, [form]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let disposed = false; let off: (() => void) | undefined;
    void listen<PresentationStatus>(MAIN_EVENTS.presentationStatus, ({ payload }) => { if (!disposed) setStatus((previous) => previous && previous.generation > payload.generation ? previous : payload); })
      .then((value) => { if (disposed) value(); else off = value; })
      .catch((reason) => { if (!disposed) setError(`监听演示状态失败：${errorMessage(reason)}`); });
    return () => { disposed = true; off?.(); };
  }, []);
  if (loading) return <div className={styles.centerState}><Spin tip="读取演示辅助设置…" /></div>;
  if (!saved || !status) return <Alert type="error" showIcon message="读取演示设置失败" description={error} action={<Button onClick={() => void load()}>重试</Button>} />;
  const starting = status.phase === "starting";
  const dirty = JSON.stringify(toConfig(values ?? toFormValues(saved))) !== JSON.stringify(saved);
  const save = async (next: PresentationFormValues) => {
    setBusy(true); setError(null);
    try { const config = await presentationApi.update(toConfig(next)); setSaved(config); form.setFieldsValue(toFormValues(config)); form.resetFields(); setStatus(await presentationApi.status()); message.success("演示偏好已保存"); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  const toggleMode = async () => {
    setBusy(true); setError(null);
    try { setStatus(await presentationApi.setEnabled(!status.enabled)); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  return <div className={styles.settingsStack}>
    {error && <Alert type="error" showIcon message="操作未完成" description={error} />}
    <Card className={styles.glassCard} bordered={false}>
      <div className={styles.sectionHeader}><div><Typography.Title level={4}>演示模式</Typography.Title><Typography.Text type="secondary">一键显示按键、鼠标效果和锁定键状态，退出后恢复普通按键设置。</Typography.Text></div><Space wrap><Tag color={status.error ? "error" : status.enabled ? "success" : "default"}>{status.error ? "运行异常" : starting ? "启用中" : status.enabled ? "运行中" : "已关闭"}</Tag><Switch checked={status.enabled} checkedChildren="运行中" unCheckedChildren="已关闭" loading={busy} disabled={busy || (!status.enabled && dirty)} onChange={() => void toggleMode()} /></Space></div>
      {status.error && <Alert className={styles.inlineAlert} type="error" showIcon message="演示辅助异常" description={status.error} action={<Button disabled={busy || dirty} onClick={() => void presentationApi.retry().then(setStatus).catch((reason) => setError(errorMessage(reason)))}>重试</Button>} />}
    </Card>
    <Form form={form} layout="vertical" className={styles.settingsForm} disabled={busy || starting} onFinish={(next) => void save(next)}>
      <Card className={styles.glassCard} bordered={false} title="演示内容"><div className={styles.formSwitchGrid}>{[['keyboard','键盘快捷键','组合键、功能键和方向键'],['clicks','鼠标点击','左键蓝色、右键粉色、中键紫色圆环'],['highlight','鼠标高亮与定位','黄色跟随光圈与定位动画'],['lock_keys','锁定键状态','提示 CapsLock 和 NumLock 状态']].map(([name,label,detail]) => <Form.Item key={name} name={name} valuePropName="checked" label={<><Typography.Text strong>{label}</Typography.Text><span className={styles.description}>{detail}</span></>}><Switch /></Form.Item>)}</div><Form.Item name="key_inputs" label="单独按键展示"><Select mode="multiple" showSearch={false} placeholder="请选择需展示的单独按键" className={styles.multiSelect} options={[{ value: "characters", label: "单独字符键" }, { value: "modifiers", label: "单独修饰键" }]} /></Form.Item></Card>
      <Card className={styles.glassCard} bordered={false} title="快捷键"><div className={styles.formFieldGrid}><Form.Item name="toggle_shortcut" label="切换演示模式" rules={[{ required: true, message: "请输入切换快捷键" }]}><Input /></Form.Item><Form.Item name="locate_shortcut" label="定位鼠标" rules={[{ required: true, message: "请输入定位快捷键" }]}><Input /></Form.Item></div><Space wrap><Button type="primary" htmlType="submit" loading={busy} disabled={!dirty}>保存演示偏好</Button><Button disabled={busy || !dirty} onClick={() => { form.setFieldsValue(toFormValues(saved)); form.resetFields(); setError(null); }}>撤销修改</Button><Button disabled={busy || !status.enabled || !status.config.highlight || starting} onClick={() => void presentationApi.locate().catch((reason) => setError(errorMessage(reason)))}>定位鼠标</Button>{dirty && <Typography.Text type="secondary">有未保存的修改</Typography.Text>}</Space></Card>
    </Form>
    <KeyVisualizerSettings disabled={status.enabled} />
  </div>;
}
