import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Alert, App as AntApp, Button, Card, Input, Select, Typography } from "antd";
import type { ScreenshotConfig } from "../types";
import styles from "./components.module.scss";

const { Text } = Typography;

export default function ScreenshotSettings() {
  const { notification } = AntApp.useApp();
  const [config, setConfig] = useState<ScreenshotConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void invoke<ScreenshotConfig>("get_screenshot_config")
      .then(setConfig)
      .catch((error) =>
        notification.error({ message: "读取截图设置失败", description: String(error) }),
      );
  }, [notification]);

  const save = async (next: ScreenshotConfig) => {
    setSaving(true);
    try {
      const saved = await invoke<ScreenshotConfig>("update_screenshot_config", {
        screenshotConfig: next,
      });
      setConfig(saved);
      notification.success({ message: "截图设置已保存" });
    } catch (error) {
      notification.error({ message: "保存截图设置失败", description: String(error) });
    } finally {
      setSaving(false);
    }
  };

  const chooseDirectory = async () => {
    if (!config) return;
    const directory = await invoke<string | null>("choose_screenshot_save_directory");
    if (directory) await save({ ...config, save_directory: directory });
  };

  const start = async () => {
    try {
      await invoke("start_screenshot");
    } catch (error) {
      notification.error({ message: "启动截图失败", description: String(error) });
    }
  };

  return (
    <div className={styles.page}>
      <Card className={styles.surfaceCard} title="LiteSnap 截图">
        <div className={styles.settingsGroup}>
          <div className={styles.settingRow}>
            <div className={styles.settingCopy}>
              <Text strong>立即截图</Text>
              <span className={styles.description}>
                截取鼠标所在显示器，支持选区、标注、滚动长截图、复制、保存和置顶。
              </span>
            </div>
            <Button type="primary" onClick={() => void start()}>
              开始截图
            </Button>
          </div>
          <div className={styles.settingRow}>
            <div className={styles.settingCopy}>
              <Text strong>全局快捷键</Text>
              <span className={styles.description}>
                Ctrl+1 打开冻结截图并框选；Ctrl+2 将最近一次已确认的选区截图贴到屏幕。
              </span>
            </div>
          </div>
          {config && (
            <>
              <div className={styles.settingRow}>
                <div className={styles.settingCopy}>
                  <Text strong>默认保存目录</Text>
                  <span className={styles.description}>
                    {config.save_directory || "每次仍显示另存为窗口；未设置时使用系统默认目录。"}
                  </span>
                </div>
                <div className={styles.actionRow}>
                  <Button loading={saving} onClick={() => void chooseDirectory()}>
                    选择目录
                  </Button>
                  {config.save_directory && (
                    <Button onClick={() => void save({ ...config, save_directory: null })}>
                      清除
                    </Button>
                  )}
                </div>
              </div>
              <div className={styles.settingRow}>
                <div className={styles.settingCopy}>
                  <Text strong>OCR 引擎</Text>
                  <span className={styles.description}>
                    默认 ONNX；切换后只会加载并运行当前选择的离线引擎。
                  </span>
                </div>
                <Select
                  value={config.ocr_engine}
                  disabled={saving}
                  style={{ width: 190 }}
                  options={[
                    { value: "onnx", label: "ONNX · PP-OCRv6 small" },
                    { value: "rusto", label: "RustO MNN · PP-OCRv6 small" },
                  ]}
                  onChange={(ocr_engine) => void save({ ...config, ocr_engine })}
                />
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
                  onChange={(color_copy_format) => void save({ ...config, color_copy_format })}
                />
              </div>
              <div className={styles.settingRow}>
                <div className={styles.settingCopy}>
                  <Text strong>文件名前缀</Text>
                  <span className={styles.description}>保存文件名格式：前缀-时间戳.png</span>
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
        description="区域选择后可使用形状、画笔、高亮、马赛克、文字、取色笔、二维码识别和像素标尺。取色笔按 C 复制不带 # 的 HEX 颜色值；长截图开始后再次按 Ctrl+1 完成拼接。"
      />
    </div>
  );
}
