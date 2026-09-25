import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Form,
  Grid,
  Input,
  Row,
  Select,
  Spin,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ScreenshotConfig, ShortcutRuntimeStatus } from "../types";
import styles from "./components.module.scss";
import ScreenshotHistory from "./ScreenshotHistory";
import ShortcutSelect from "./ShortcutSelect";
import { errorMessage, MAIN_EVENTS, screenshotSettingsApi } from "../api/commands";
import { resetShortcutConfig, shortcutStatusDisplay } from "../utils/shortcutStatus";
import {
  SCREENSHOT_SHORTCUT_FIELDS,
  validateScreenshotShortcutDraft,
  type ScreenshotShortcutField,
} from "./screenshotSettingsSave";
import { useQueuedAutosave } from "../hooks/useQueuedAutosave";
import { takeDetachedAutosaveError, waitForPendingAutosave } from "../hooks/queuedAutosave";

const { Text } = Typography;
interface ScreenshotSettingsProps {
  activeTab: "history" | "settings";
  onActiveTabChange: (tab: "history" | "settings") => void;
}
const shortcutFields: Array<
  [ScreenshotShortcutField, string, string, ShortcutRuntimeStatus["actionId"]]
> = [
  ["quick_ocr_shortcut", "快速 OCR", "框选后松开鼠标即识别并复制文本", "quick_ocr"],
  ["shortcut", "区域截图", "唤起截图浮层并选择截图区域", "capture"],
  ["pin_shortcut", "最近截图贴图", "将最近一次确认的截图置顶到屏幕", "pin_recent"],
  ["history_shortcut", "打开截图历史", "显示主窗口并切换到截图历史", "open_history"],
  ["toggle_pin_shortcut", "显隐最近贴图", "隐藏或恢复最近创建的贴图", "toggle_latest_pin"],
];
const shortcutNames = SCREENSHOT_SHORTCUT_FIELDS;

export default function ScreenshotSettings({
  activeTab,
  onActiveTabChange,
}: ScreenshotSettingsProps) {
  const { notification } = AntApp.useApp();
  const screens = Grid.useBreakpoint();
  const [form] = Form.useForm<ScreenshotConfig>();
  const [saved, setSaved] = useState<ScreenshotConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [shortcutStatuses, setShortcutStatuses] = useState<ShortcutRuntimeStatus[]>([]);
  const values = Form.useWatch([], form);

  const refreshStatuses = useCallback(async () => {
    try {
      setShortcutStatuses(await screenshotSettingsApi.shortcutStatuses());
    } catch (error) {
      setShortcutStatuses([]);
      notification.error({
        message: "读取快捷键状态失败",
        description: errorMessage(error),
      });
    }
  }, [notification]);

  const {
    schedule: queueSave,
    invalidate: invalidateSave,
    isCurrent: isSaveCurrent,
  } = useQueuedAutosave({
    key: "screenshot-settings",
    delayMs: 0,
    save: screenshotSettingsApi.update,
    onSavingChange: setSaving,
    onSuccess: async (config, { latest }) => {
      setSaved(config);
      if (!latest) return;
      form.setFieldsValue(config);
      setSaveError(null);
      await refreshStatuses();
    },
    onError: (error, { latest }) => {
      if (latest) setSaveError(errorMessage(error));
    },
    onDetachedError: (error) => notification.error({
      message: "截图设置未保存",
      description: errorMessage(error),
    }),
  });

  const load = useCallback(async () => {
    const revision = invalidateSave();
    setLoading(true);
    setSaveError(null);
    try {
      await waitForPendingAutosave("screenshot-settings");
      const [config, statuses] = await Promise.all([
        screenshotSettingsApi.get(),
        screenshotSettingsApi.shortcutStatuses(),
      ]);
      if (!isSaveCurrent(revision)) return;
      const pendingError = takeDetachedAutosaveError("screenshot-settings");
      if (pendingError) setSaveError(errorMessage(pendingError));
      setSaved(config);
      form.setFieldsValue(config);
      setShortcutStatuses(statuses);
    } catch (error) {
      if (isSaveCurrent(revision)) setSaveError(errorMessage(error));
    } finally {
      if (isSaveCurrent(revision)) setLoading(false);
    }
  }, [form, invalidateSave, isSaveCurrent]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    void listen(MAIN_EVENTS.shortcutStatusChanged, () => void refreshStatuses())
      .then((value) => {
        if (disposed) value();
        else off = value;
      })
      .catch((error) =>
        notification.error({ message: "监听截图快捷键失败", description: errorMessage(error) }),
      );
    return () => {
      disposed = true;
      off?.();
    };
  }, [notification, refreshStatuses]);

  const dirty = useMemo(
    () => !!saved && !!values && JSON.stringify(values) !== JSON.stringify(saved),
    [saved, values],
  );

  const validateShortcuts = useCallback(
    (next: ScreenshotConfig): boolean => {
      form.setFields(shortcutNames.map((name) => ({ name, errors: [] })));
      const { invalid, duplicates } = validateScreenshotShortcutDraft(next);
      if (invalid.length > 0) {
        form.setFields(
          invalid.map((name) => ({ name, errors: ["请选择一个或两个修饰键，并指定受支持的主键"] })),
        );
        setSaveError("快捷键格式无效，请重新选择标记的快捷键");
        return false;
      }
      if (duplicates.length > 0) {
        form.setFields(
          duplicates.map((name) => ({ name, errors: ["快捷键不能与其他截图操作重复"] })),
        );
        setSaveError("快捷键重复，请为标记的操作选择不同组合");
        return false;
      }
      return true;
    },
    [form],
  );

  const scheduleSave = useCallback(
    (next: ScreenshotConfig, delay = 0) => {
      invalidateSave();
      setSaveError(null);
      if (!validateShortcuts(next)) return;
      queueSave(next, delay);
    },
    [invalidateSave, queueSave, validateShortcuts],
  );

  const resetShortcuts = async () => {
    if (!saved) return;
    invalidateSave();
    setSaving(true);
    setSaveError(null);
    try {
      const result = await resetShortcutConfig(saved, screenshotSettingsApi.resetShortcuts);
      setSaved(result.config);
      form.setFieldsValue(result.config);
      await refreshStatuses();
      if (result.error) throw result.error;
      notification.success({ message: "已恢复默认截图快捷键" });
    } catch (error) {
      notification.error({ message: "恢复默认快捷键失败", description: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };
  const chooseDirectory = async () => {
    try {
      const directory = await screenshotSettingsApi.chooseSaveDirectory();
      if (directory) {
        const next = { ...form.getFieldsValue(true), save_directory: directory };
        form.setFieldsValue(next);
        scheduleSave(next);
      }
    } catch (error) {
      notification.error({ message: "选择目录失败", description: errorMessage(error) });
    }
  };

  const status = (id: ShortcutRuntimeStatus["actionId"]) => {
    const display = shortcutStatusDisplay(shortcutStatuses.find((item) => item.actionId === id));
    return (
      <span className={styles.shortcutStatus}>
        <Tag color={display.color}>{display.label}</Tag>
        {display.detail && <span className={styles.shortcutError}>{display.detail}</span>}
      </span>
    );
  };
  const settings = loading ? (
    <div className={styles.centerState}>
      <Spin tip="读取截图设置…" />
    </div>
  ) : !saved ? (
    <Alert
      type="error"
      showIcon
      message="截图设置读取失败"
      description={saveError}
      action={<Button onClick={() => void load()}>重试</Button>}
    />
  ) : (
    <Form
      form={form}
      layout="vertical"
      className={styles.settingsForm}
      onValuesChange={(changed, next) => scheduleSave(next, "filename_prefix" in changed ? 400 : 0)}
    >
      <Card className={styles.surfaceCard} title="截图">
        <div className={styles.settingsGroup}>
          <div className={styles.settingRow}>
            <div className={styles.settingCopy}>
              <Text strong>立即截图</Text>
              <span className={styles.description}>
                截取鼠标所在显示器，支持选区、标注、OCR、复制、保存和置顶。
              </span>
            </div>
            <Button
              type="primary"
              onClick={() =>
                void screenshotSettingsApi.start().catch((error) =>
                  notification.error({
                    message: "启动截图失败",
                    description: errorMessage(error),
                  }),
                )
              }
            >
              开始截图
            </Button>
          </div>
          <div className={`${styles.settingRow} ${styles.shortcutSection}`}>
            <Row className={styles.shortcutHeader} gutter={[12, 8]} align="middle">
              <Col flex="auto">
                <div className={styles.settingCopy}>
                  <Text strong>全局快捷键</Text>
                  <span className={styles.description}>
                    选择一个修饰键和主键，也可增加第二个修饰键；修改后自动注册。
                  </span>
                </div>
              </Col>
              <Col>
                <Button loading={saving} onClick={() => void resetShortcuts()}>
                  恢复默认
                </Button>
              </Col>
            </Row>
            <div className={styles.shortcutList}>
              {shortcutFields.map(([name, label, detail, id]) => (
                <Row className={styles.shortcutItem} key={name} gutter={[12, 8]} align="middle">
                  <Col xs={24} lg={7}>
                    <div className={styles.shortcutCopy}>
                      <Text>{label}</Text>
                      <span className={styles.description}>{detail}</span>
                    </div>
                  </Col>
                  <Col xs={24} lg={17}>
                    <div className={styles.shortcutBinding}>
                      {status(id)}
                      <Form.Item
                        className={styles.shortcutFormItem}
                        name={name}
                        rules={[{ required: true, message: "请选择快捷键" }]}
                      >
                        <ShortcutSelect aria-label={label} />
                      </Form.Item>
                    </div>
                  </Col>
                </Row>
              ))}
            </div>
          </div>
          <Form.Item name="save_directory" label="默认保存目录">
            <Input
              readOnly
              addonAfter={
                <Button type="link" size="small" onClick={() => void chooseDirectory()}>
                  选择目录
                </Button>
              }
            />
          </Form.Item>
          <Row gutter={screens.lg ? 16 : 12}>
            <Col xs={24} lg={12}>
              <Form.Item name="color_copy_format" label="取色复制格式">
                <Select
                  options={["hex", "rgb", "hsl", "hsv", "css"].map((value) => ({
                    value,
                    label: value.toUpperCase(),
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} lg={12}>
              <Form.Item name="capture_size_unit" label="截图尺寸单位">
                <Select
                  options={[
                    { value: "px", label: "PX（导出像素）" },
                    { value: "dip", label: "DIP（逻辑尺寸）" },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="filename_prefix" label="文件名前缀">
            <Input />
          </Form.Item>
          {saveError && (
            <Alert
              type="error"
              showIcon
              message="截图设置未保存"
              description={saveError}
              action={
                <Button size="small" onClick={() => scheduleSave(form.getFieldsValue(true))}>
                  重试保存
                </Button>
              }
            />
          )}
          <div className={styles.autoSaveFooter}>
            <Text type="secondary">
              {saveError
                ? "保存失败"
                : saving
                  ? "正在自动保存…"
                  : dirty
                    ? "等待自动保存…"
                    : "已自动保存"}
            </Text>
            <Button
              disabled={!dirty || saving}
              onClick={() => {
                if (saved) {
                  invalidateSave();
                  form.setFieldsValue(saved);
                  form.setFields(shortcutNames.map((name) => ({ name, errors: [] })));
                  setSaveError(null);
                }
              }}
            >
              撤销修改
            </Button>
          </div>
        </div>
      </Card>
      <Alert
        type="info"
        showIcon
        message="截图交互"
        description="区域选择后可使用形状、画笔、高亮、马赛克、文字、取色笔、二维码识别和像素标尺。"
      />
    </Form>
  );
  return (
    <div className={styles.page}>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => onActiveTabChange(key as "history" | "settings")}
        items={[
          { key: "history", label: "截图历史", children: <ScreenshotHistory /> },
          { key: "settings", label: "截图设置", children: settings },
        ]}
      />
    </div>
  );
}
