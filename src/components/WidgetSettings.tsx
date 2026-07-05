import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  Card,
  Typography,
  Slider,
  RadioGroup,
  Radio,
  Button,
  Notification,
  Modal,
} from "@douyinfe/semi-ui";
import { IconRefresh } from "@douyinfe/semi-icons";

const { Text } = Typography;

interface WidgetConfig {
  memory_scheme: number;
}

export default function WidgetSettings() {
  const [refreshInterval, setRefreshInterval] = useState(1);
  const [memoryScheme, setMemoryScheme] = useState<number>(1);
  const [checking, setChecking] = useState(false);

  // ── Load persisted config on mount ────────────────────────────────
  useEffect(() => {
    invoke<WidgetConfig>("get_widget_config")
      .then((cfg) => setMemoryScheme(cfg.memory_scheme))
      .catch((err) => console.error("Failed to load widget config:", err));
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────
  const handleSchemeChange = (v: number) => {
    setMemoryScheme(v);
    invoke("update_widget_config", {
      config: { memory_scheme: v },
    }).catch((err) => Notification.error({ content: `同步失败: ${err}` }));
  };

  const handleSliderChange = (v: number) => {
    setRefreshInterval(v);
  };

  // ── Check for updates ─────────────────────────────────────────────
  const handleCheckUpdate = async () => {
    setChecking(true);
    try {
      const update = await check();
      if (!update) {
        Notification.success({ content: "当前已是最新版本" });
        return;
      }
      Modal.confirm({
        title: "发现新版本",
        content: `版本 ${update.version} 可用，是否立即下载并安装？`,
        okText: "更新",
        cancelText: "稍后",
        onOk: async () => {
          try {
            await update.downloadAndInstall();
            await relaunch();
          } catch (err) {
            Notification.error({ content: `更新安装失败: ${err}` });
          }
        },
      });
    } catch (err) {
      Notification.error({ content: `检查更新失败: ${err}` });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── Memory scheme ────────────────────────────────────────── */}
      <Card title="内存显示方案" style={{ borderRadius: 8 }}>
        <RadioGroup
          type="button"
          value={memoryScheme}
          onChange={(e: any) => handleSchemeChange(e.target.value as number)}
          aria-label="内存方案切换"
        >
          <Radio value={1}>胶囊呼吸灯</Radio>
          <Radio value={2}>环形进度条</Radio>
          <Radio value={3}>微型刻度条</Radio>
        </RadioGroup>
        <Text
          type="secondary"
          style={{ display: "block", marginTop: 8, fontSize: 12 }}
        >
          切换后任务栏挂件将即时重绘，无需保存。
        </Text>
      </Card>

      {/* ── Refresh interval ──────────────────────────────────────── */}
      <Card title="网速刷新频率" style={{ borderRadius: 8 }}>
        <div style={{ padding: "0 8px" }}>
          <Slider
            step={1}
            min={1}
            max={5}
            value={refreshInterval}
            onChange={handleSliderChange}
            marks={{ 1: "1s", 2: "2s", 3: "3s", 4: "4s", 5: "5s" }}
          />
        </div>
      </Card>

      {/* ── Software update ───────────────────────────────────────── */}
      <Card title="软件更新" style={{ borderRadius: 8 }}>
        <Button
          icon={<IconRefresh />}
          loading={checking}
          onClick={handleCheckUpdate}
        >
          检查更新
        </Button>
        <Text
          type="secondary"
          style={{ display: "block", marginTop: 8, fontSize: 12 }}
        >
          自动从 GitHub Releases 检查并安装最新版本。
        </Text>
      </Card>
    </div>
  );
}
