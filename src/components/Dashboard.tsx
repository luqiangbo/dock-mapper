import { useCallback, useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { Alert, App as AntApp, Button, Card, Spin, Typography } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CameraOutlined,
  DashboardOutlined,
  HistoryOutlined,
  KeyOutlined,
  MenuOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { RuntimeHealth, ScancodeMapStatus, SysStatus } from "../types";
import { errorMessage, keyMappingApi, MAIN_EVENTS, runtimeApi, screenshotSettingsApi } from "../api/commands";
import { formatSpeed } from "../utils/format";
import MetricTrendChart from "./MetricTrendChart";
import type { DashboardSample } from "./dashboardTelemetry";
import styles from "./components.module.scss";

const { Text, Title } = Typography;
const NETWORK_SERIES = [
  { key: "upload" as const, name: "上传", color: "#f59e0b" },
  { key: "download" as const, name: "下载", color: "#3b82f6" },
];
const RESOURCE_SERIES = [
  { key: "cpu" as const, name: "CPU", color: "#8b5cf6" },
  { key: "memory" as const, name: "内存", color: "#10b981" },
];

interface Props {
  status: SysStatus | null;
  samples: DashboardSample[];
  onNavigate: (page: "keymapper" | "screenshot" | "widget", tab?: "history" | "settings") => void;
}

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <Card className={styles.glassCard}>
    <div className={styles.metric}><span className={styles.metricIcon}>{icon}</span><div><Text type="secondary">{label}</Text><span className={styles.metricValue}>{value}</span></div></div>
  </Card>;
}

export default function Dashboard({ status, samples, onNavigate }: Props) {
  const [mapStatus, setMapStatus] = useState<ScancodeMapStatus | null>(null);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [startingCapture, setStartingCapture] = useState(false);
  const { notification } = AntApp.useApp();

  const refreshMapStatus = useCallback(async () => {
    setMapError(null);
    try { setMapStatus(await keyMappingApi.status()); }
    catch (error) { setMapStatus(null); setMapError(errorMessage(error)); }
  }, []);
  const refreshRuntimeHealth = useCallback(async () => {
    setHealthError(null);
    try { setRuntimeHealth(await runtimeApi.health()); }
    catch (error) { setRuntimeHealth(null); setHealthError(errorMessage(error)); }
  }, []);

  useEffect(() => {
    void refreshMapStatus();
    void refreshRuntimeHealth();
    const timer = window.setInterval(() => void refreshRuntimeHealth(), 5000);
    const mapListener = listen(MAIN_EVENTS.scancodeMapChanged, () => void refreshMapStatus());
    const shortcutListener = listen(MAIN_EVENTS.shortcutStatusChanged, () => void refreshRuntimeHealth());
    return () => {
      void mapListener.then((unlisten) => unlisten());
      void shortcutListener.then((unlisten) => unlisten());
      window.clearInterval(timer);
    };
  }, [refreshMapStatus, refreshRuntimeHealth]);

  const startCapture = async () => {
    setStartingCapture(true);
    try { await screenshotSettingsApi.start(); }
    catch (error) { notification.error({ message: "启动截图失败", description: errorMessage(error) }); }
    finally { setStartingCapture(false); }
  };
  const mappingLabel = !mapStatus ? "读取中" : mapStatus.state === "applied" ? "已写入系统" : mapStatus.state === "draft_changed" ? "草稿待应用" : mapStatus.state === "system_changed" ? "系统映射已变化" : "尚未应用";
  const registeredShortcuts = runtimeHealth?.screenshot.shortcuts.filter((item) => item.registered).length ?? 0;
  const shortcutTotal = runtimeHealth?.screenshot.shortcuts.length ?? 0;
  const quickOcrAvailable = runtimeHealth?.screenshot.shortcuts.find((item) => item.actionId === "quick_ocr")?.registered;

  return <div className={styles.page}>
    <section className={styles.dashboardHero}>
      <div><Text type="secondary">本机实时概览</Text><Title level={3}>运行状态一目了然</Title></div>
      <span className={styles.liveBadge}><i />{status ? "实时更新" : "等待采样"}</span>
    </section>

    <div className={styles.dashboardMetrics}>
      <MetricCard icon={<ArrowUpOutlined />} label={!status ? "实时上传" : status.network_available ? "实时上传" : "上传（网卡不可用）"} value={status?.network_available ? formatSpeed(status.upload_speed) : "—"} />
      <MetricCard icon={<ArrowDownOutlined />} label={!status ? "实时下载" : status.network_available ? "实时下载" : "下载（网卡不可用）"} value={status?.network_available ? formatSpeed(status.download_speed) : "—"} />
      <MetricCard icon={<DashboardOutlined />} label="CPU 占用" value={status?.cpu_usage == null ? "—" : `${status.cpu_usage.toFixed(0)}%`} />
      <MetricCard icon={<DashboardOutlined />} label="内存占用" value={status == null ? "—" : `${status.memory_usage.toFixed(0)}%`} />
      {status?.battery && <MetricCard icon={<DashboardOutlined />} label={status.battery.charging ? "电池（充电中）" : "电池"} value={`${status.battery.percentage.toFixed(0)}%`} />}
    </div>

    <div className={styles.dashboardCharts}>
      <Card className={styles.surfaceCard} title="网络趋势 · 最近 5 分钟">
        {samples.length < 2 ? <div className={styles.chartEmpty}><Spin size="small" /><Text type="secondary">正在等待更多网络采样…</Text></div> : <MetricTrendChart title="网络趋势" samples={samples} series={NETWORK_SERIES} />}
      </Card>
      <Card className={styles.surfaceCard} title="资源趋势 · 最近 5 分钟">
        {samples.length < 2 ? <div className={styles.chartEmpty}><Spin size="small" /><Text type="secondary">正在等待更多资源采样…</Text></div> : <MetricTrendChart title="资源趋势" samples={samples} series={RESOURCE_SERIES} percent />}
      </Card>
    </div>

    <div className={styles.dashboardModules}>
      <Card className={styles.surfaceCard} title="功能状态">
        <div className={styles.dashboardStatusList}>
          {mapError ? <Alert type="error" showIcon message="扫描码映射状态读取失败" description={mapError} action={<Button size="small" icon={<ReloadOutlined />} onClick={() => void refreshMapStatus()}>重试</Button>} /> : <div className={styles.dashboardStatusRow}><span><KeyOutlined />扫描码映射</span><b>{mappingLabel}</b></div>}
          {healthError ? <Alert type="error" showIcon message="运行统计读取失败" description={healthError} action={<Button size="small" icon={<ReloadOutlined />} onClick={() => void refreshRuntimeHealth()}>重试</Button>} /> : runtimeHealth ? <>
            <div className={styles.dashboardStatusRow}><span><CameraOutlined />截图快捷键</span><b>{registeredShortcuts}/{shortcutTotal} 可用</b></div>
            <div className={styles.dashboardStatusRow}><span><DashboardOutlined />最近捕获</span><b>{runtimeHealth.screenshot.recentCaptureBackend ?? "暂无"}{runtimeHealth.screenshot.recentCaptureMs == null ? "" : ` · ${runtimeHealth.screenshot.recentCaptureMs} ms`}</b></div>
            <div className={styles.dashboardStatusRow}><span><DashboardOutlined />OCR / 贴图</span><b>OCR {quickOcrAvailable ? "可用" : "不可用"} · 贴图 {runtimeHealth.screenshot.pinCount}</b></div>
            <div className={styles.dashboardStatusRow}><span><HistoryOutlined />截图历史</span><b>{runtimeHealth.historyCount} 项</b></div>
          </> : <Spin size="small" />}
        </div>
      </Card>
      <Card className={styles.surfaceCard} title="快捷操作">
        <div className={styles.dashboardActions}>
          <Button type="primary" icon={<CameraOutlined />} loading={startingCapture} onClick={() => void startCapture()}>开始截图</Button>
          <Button icon={<HistoryOutlined />} onClick={() => onNavigate("screenshot", "history")}>截图历史</Button>
          <Button icon={<KeyOutlined />} onClick={() => onNavigate("keymapper")}>按键映射</Button>
          <Button icon={<MenuOutlined />} onClick={() => onNavigate("widget")}>挂件设置</Button>
        </div>
      </Card>
    </div>
  </div>;
}
