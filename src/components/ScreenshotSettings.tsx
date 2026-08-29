import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Alert, App as AntApp, Button, Card, Input, Select, Tabs, Tag, Typography } from "antd";
import type { ScreenshotConfig, ShortcutRuntimeStatus } from "../types";
import styles from "./components.module.scss";
import { shortcutFromKeyEvent } from "../utils/shortcut";
import ScreenshotHistory from "./ScreenshotHistory";
import { errorMessage, MAIN_EVENTS, screenshotSettingsApi } from "../api/commands";
import { resetShortcutConfig, shortcutStatusDisplay } from "../utils/shortcutStatus";

const { Text } = Typography;

interface ScreenshotSettingsProps {
  activeTab: "history" | "settings";
  onActiveTabChange: (tab: "history" | "settings") => void;
}

export default function ScreenshotSettings({
  activeTab,
  onActiveTabChange,
}: ScreenshotSettingsProps) {
  const { notification } = AntApp.useApp();
  const [config, setConfig] = useState<ScreenshotConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [shortcutStatuses, setShortcutStatuses] = useState<ShortcutRuntimeStatus[]>([]);

  const refreshShortcutStatuses = () =>
    screenshotSettingsApi
      .shortcutStatuses()
      .then(setShortcutStatuses)
      .catch(() => setShortcutStatuses([]));

  useEffect(() => {
    void Promise.all([screenshotSettingsApi.get(), screenshotSettingsApi.shortcutStatuses()])
      .then(([nextConfig, statuses]) => {
        setConfig(nextConfig);
        setShortcutStatuses(statuses);
      })
      .catch((error) =>
        notification.error({ message: "读取截图设置失败", description: errorMessage(error) }),
      );
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen(MAIN_EVENTS.shortcutStatusChanged, () => void refreshShortcutStatuses()).then(
      (off) => {
        if (disposed) off();
        else unlisten = off;
      },
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [notification]);

  const save = async (next: ScreenshotConfig) => {
    setSaving(true);
    try {
      const saved = await screenshotSettingsApi.update(next);
      setConfig(saved);
      await refreshShortcutStatuses();
      notification.success({ message: "截图设置已保存" });
    } catch (error) {
      notification.error({ message: "保存截图设置失败", description: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const resetShortcuts = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const result = await resetShortcutConfig(config, screenshotSettingsApi.resetShortcuts);
      setConfig(result.config);
      await refreshShortcutStatuses();
      if (result.error) throw result.error;
      notification.success({ message: "已恢复默认截图快捷键" });
    } catch (error) {
      await refreshShortcutStatuses();
      notification.error({ message: "恢复默认快捷键失败", description: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const shortcutStatus = (actionId: ShortcutRuntimeStatus["actionId"]) => {
    const status = shortcutStatuses.find((item) => item.actionId === actionId);
    const display = shortcutStatusDisplay(status);
    return (
      <span className={styles.shortcutStatus}>
        <Tag color={display.color}>{display.label}</Tag>
        {display.detail ? <span className={styles.shortcutError}>{display.detail}</span> : null}
      </span>
    );
  };

  const chooseDirectory = async () => {
    if (!config) return;
    const directory = await screenshotSettingsApi.chooseSaveDirectory();
    if (directory) await save({ ...config, save_directory: directory });
  };

  const start = async () => {
    try {
      await screenshotSettingsApi.start();
    } catch (error) {
      notification.error({ message: "启动截图失败", description: errorMessage(error) });
    }
  };

  return (
    <div className={styles.page}>
      <Tabs
        activeKey={activeTab}
        onChange={(key) => onActiveTabChange(key as "history" | "settings")}
        items={[
          { key: "history", label: "截图历史", children: <ScreenshotHistory /> },
          {
            key: "settings",
            label: "截图设置",
            children: (
              <>
                <Card className={styles.surfaceCard} title="截图">
                  <div className={styles.settingsGroup}>
                    <div className={styles.settingRow}>
                      <div className={styles.settingCopy}>
                        <Text strong>立即截图</Text>
                        <span className={styles.description}>
                          截取鼠标所在显示器，支持选区、标注、OCR、复制、保存和置顶。
                        </span>
                      </div>
                      <Button type="primary" onClick={() => void start()}>
                        开始截图
                      </Button>
                    </div>
                    <div className={`${styles.settingRow} ${styles.shortcutSection}`}>
                      <div className={styles.shortcutHeader}>
                        <div className={styles.settingCopy}>
                          <Text strong>全局快捷键</Text>
                          <span className={styles.description}>
                            点击输入框后按下新的组合键；注册或保存失败时会自动恢复旧快捷键。
                          </span>
                        </div>
                        <Button disabled={saving || !config} onClick={() => void resetShortcuts()}>
                          恢复默认
                        </Button>
                      </div>
                      {config && (
                        <div className={styles.shortcutList}>
                          <div className={styles.shortcutItem}>
                            <div className={styles.shortcutCopy}>
                              <Text>区域截图</Text>
                              <span className={styles.description}>唤起截图浮层并选择截图区域</span>
                            </div>
                            <div className={styles.shortcutBinding}>
                              {shortcutStatus("capture")}
                              <Input
                                aria-label="截图快捷键"
                                value={config.shortcut}
                                readOnly
                                disabled={saving}
                                className={styles.shortcutInput}
                                onKeyDown={(event) => {
                                  event.preventDefault();
                                  const shortcut = shortcutFromKeyEvent(event.nativeEvent);
                                  if (shortcut) void save({ ...config, shortcut });
                                }}
                              />
                            </div>
                          </div>
                          <div className={styles.shortcutItem}>
                            <div className={styles.shortcutCopy}>
                              <Text>最近截图贴图</Text>
                              <span className={styles.description}>
                                将最近一次确认的截图置顶到屏幕
                              </span>
                            </div>
                            <div className={styles.shortcutBinding}>
                              {shortcutStatus("pin_recent")}
                              <Input
                                aria-label="贴图快捷键"
                                value={config.pin_shortcut}
                                readOnly
                                disabled={saving}
                                className={styles.shortcutInput}
                                onKeyDown={(event) => {
                                  event.preventDefault();
                                  const pin_shortcut = shortcutFromKeyEvent(event.nativeEvent);
                                  if (pin_shortcut) void save({ ...config, pin_shortcut });
                                }}
                              />
                            </div>
                          </div>
                          <div className={styles.shortcutItem}>
                            <div className={styles.shortcutCopy}>
                              <Text>打开截图历史</Text>
                              <span className={styles.description}>显示主窗口并切换到截图历史</span>
                            </div>
                            <div className={styles.shortcutBinding}>
                              {shortcutStatus("open_history")}
                              <Input
                                aria-label="截图历史快捷键"
                                value={config.history_shortcut}
                                readOnly
                                disabled={saving}
                                className={styles.shortcutInput}
                                onKeyDown={(event) => {
                                  event.preventDefault();
                                  const history_shortcut = shortcutFromKeyEvent(event.nativeEvent);
                                  if (history_shortcut) void save({ ...config, history_shortcut });
                                }}
                              />
                            </div>
                          </div>
                          <div className={styles.shortcutItem}>
                            <div className={styles.shortcutCopy}>
                              <Text>显隐最近贴图</Text>
                              <span className={styles.description}>
                                隐藏或恢复最近创建且仍存在的贴图
                              </span>
                            </div>
                            <div className={styles.shortcutBinding}>
                              {shortcutStatus("toggle_latest_pin")}
                              <Input
                                aria-label="贴图显隐快捷键"
                                value={config.toggle_pin_shortcut}
                                readOnly
                                disabled={saving}
                                className={styles.shortcutInput}
                                onKeyDown={(event) => {
                                  event.preventDefault();
                                  const toggle_pin_shortcut = shortcutFromKeyEvent(event.nativeEvent);
                                  if (toggle_pin_shortcut)
                                    void save({ ...config, toggle_pin_shortcut });
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    {config && (
                      <>
                        <div className={styles.settingRow}>
                          <div className={styles.settingCopy}>
                            <Text strong>默认保存目录</Text>
                            <span className={styles.description}>
                              {config.save_directory ||
                                "每次仍显示另存为窗口；未设置时使用系统默认目录。"}
                            </span>
                          </div>
                          <div className={styles.actionRow}>
                            <Button loading={saving} onClick={() => void chooseDirectory()}>
                              选择目录
                            </Button>
                          </div>
                        </div>
                        <div className={styles.settingRow}>
                          <div className={styles.settingCopy}>
                            <Text strong>取色复制格式</Text>
                            <span className={styles.description}>
                              取色面板和最近颜色使用此格式；C 快捷键始终复制无 # 的 HEX。
                            </span>
                          </div>
                          <Select
                            value={config.color_copy_format}
                            disabled={saving}
                            style={{ width: 140 }}
                            options={["hex", "rgb", "hsl", "hsv", "css"].map((value) => ({
                              value,
                              label: value.toUpperCase(),
                            }))}
                            onChange={(color_copy_format) =>
                              void save({ ...config, color_copy_format })
                            }
                          />
                        </div>
                        <div className={styles.settingRow}>
                          <div className={styles.settingCopy}>
                            <Text strong>文件名前缀</Text>
                            <span className={styles.description}>
                              保存文件名格式：前缀-时间戳.png
                            </span>
                          </div>
                          <Input
                            value={config.filename_prefix}
                            style={{ width: 180 }}
                            disabled={saving}
                            onChange={(event) =>
                              setConfig({ ...config, filename_prefix: event.target.value })
                            }
                            onBlur={() => void save(config)}
                            onPressEnter={() => void save(config)}
                          />
                        </div>
                      </>
                    )}
                  </div>
                </Card>
                <Alert
                  type="info"
                  showIcon
                  message="截图交互"
                  description="区域选择后可使用形状、画笔、高亮、马赛克、文字、取色笔、二维码识别和像素标尺。取色笔按 C 复制不带 # 的 HEX 颜色值。"
                />
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
