import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Card, Spin, Typography } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DashboardOutlined,
  ExclamationCircleOutlined,
  KeyOutlined,
} from "@ant-design/icons";
import type { RuntimeHealth, ScancodeMapStatus, SysStatus } from "../types";
import { keyMappingApi, MAIN_EVENTS, runtimeApi } from "../api/commands";
import { formatSpeed } from "../utils/format";
import styles from "./components.module.scss";

const { Text, Title } = Typography;

export default function Dashboard() {
  const [mapStatus, setMapStatus] = useState<ScancodeMapStatus | null>(null);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth | null>(null);
  const [sysStatus, setSysStatus] = useState<SysStatus>({
    upload_speed: 0,
    download_speed: 0,
    memory_usage: 0,
    network_available: true,
  });

  useEffect(() => {
    const refreshMapStatus = () =>
      keyMappingApi
        .status()
        .then(setMapStatus)
        .catch(() => setMapStatus(null));
    void refreshMapStatus();
    const refreshRuntimeHealth = () =>
      runtimeApi
        .health()
        .then(setRuntimeHealth)
        .catch(() => setRuntimeHealth(null));
    void refreshRuntimeHealth();
    const healthTimer = window.setInterval(refreshRuntimeHealth, 5000);

    const statusListener = listen<SysStatus>(MAIN_EVENTS.systemStatus, (event) => {
      setSysStatus(event.payload);
    });
    const mapListener = listen(MAIN_EVENTS.scancodeMapChanged, () => void refreshMapStatus());
    const shortcutListener = listen(
      MAIN_EVENTS.shortcutStatusChanged,
      () => void refreshRuntimeHealth(),
    );

    return () => {
      void statusListener.then((unlisten) => unlisten());
      void mapListener.then((unlisten) => unlisten());
      void shortcutListener.then((unlisten) => unlisten());
      window.clearInterval(healthTimer);
    };
  }, []);

  const mappingLabel = !mapStatus
    ? "状态未知"
    : mapStatus.state === "applied"
      ? "已写入系统"
      : mapStatus.state === "draft_changed"
        ? "草稿待应用"
        : mapStatus.state === "system_changed"
          ? "系统映射已变化"
          : "尚未应用";
  const mappingDescription = !mapStatus
    ? "无法读取系统扫描码映射状态。"
    : mapStatus.state === "system_changed"
      ? "注册表与 DockMapper 最后一次写入的快照不一致，接管前会先备份当前值。"
      : mapStatus.state === "draft_changed"
        ? "系统仍保留上次写入的映射，当前规则草稿尚未重新应用。"
        : mapStatus.state === "applied"
          ? "DockMapper 当前规则已写入注册表；若尚未重新登录或重启，系统仍可能使用旧映射。"
          : mapStatus.backup_available
            ? "当前未应用 DockMapper 映射，可恢复接管前的系统映射。"
            : "在按键映射页配置规则并应用到系统。";

  return (
    <div className={styles.page}>
      <section className={styles.overviewPanel}>
        <div className={styles.overviewGrid}>
          <Card className={styles.glassCard}>
            <div className={styles.metric}>
              <span className={styles.metricIcon}>
                <ArrowUpOutlined />
              </span>
              <div>
                <Text type="secondary">
                  {sysStatus.network_available ? "实时上传" : "上传（网卡不可用）"}
                </Text>
                <span className={styles.metricValue}>
                  {sysStatus.network_available ? formatSpeed(sysStatus.upload_speed) : "—"}
                </span>
              </div>
            </div>
          </Card>
          <Card className={styles.glassCard}>
            <div className={styles.metric}>
              <span className={styles.metricIcon}>
                <ArrowDownOutlined />
              </span>
              <div>
                <Text type="secondary">
                  {sysStatus.network_available ? "实时下载" : "下载（网卡不可用）"}
                </Text>
                <span className={styles.metricValue}>
                  {sysStatus.network_available ? formatSpeed(sysStatus.download_speed) : "—"}
                </span>
              </div>
            </div>
          </Card>
          <Card className={styles.glassCard}>
            <div className={styles.metric}>
              <span className={styles.metricIcon}>
                <DashboardOutlined />
              </span>
              <div>
                <Text type="secondary">内存占用</Text>
                <span className={styles.metricValue}>{sysStatus.memory_usage.toFixed(0)}%</span>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <Card className={styles.surfaceCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionIdentity}>
            <span className={styles.surfaceIcon}>
              <KeyOutlined />
            </span>
            <div>
              <Title level={5}>系统扫描码映射</Title>
              <Text type="secondary">{mappingDescription}</Text>
            </div>
          </div>
          {mapStatus === null ? (
            <Spin size="small" />
          ) : (
            <span
              className={`${styles.status} ${mapStatus.state === "applied" ? styles.running : ""}`}
            >
              {mappingLabel}
            </span>
          )}
        </div>
      </Card>

      <Card className={styles.surfaceCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionIdentity}>
            <span className={styles.surfaceIcon}>
              <DashboardOutlined />
            </span>
            <div>
              <Title level={5}>本地运行状态</Title>
              {runtimeHealth ? (
                <div>
                  <Text type="secondary">
                    {`快捷键：${runtimeHealth.screenshot.shortcuts
                      .map(
                        (item) =>
                          `${item.action} ${item.shortcut} ${item.registered ? "已注册" : "失败"}`,
                      )
                      .join(" · ")}`}
                  </Text>
                  <br />
                  <Text type="secondary">
                    最近捕获 {runtimeHealth.screenshot.recentCaptureBackend ?? "暂无"}
                    {runtimeHealth.screenshot.recentCaptureMs === null
                      ? ""
                      : ` ${runtimeHealth.screenshot.recentCaptureMs} ms`}
                    {runtimeHealth.screenshot.captureP95Ms === null
                      ? ""
                      : ` · P95 ${runtimeHealth.screenshot.captureP95Ms} ms`}
                    {` · DXGI 回退 ${runtimeHealth.screenshot.dxgiFallbackCount} 次 · 贴图 ${runtimeHealth.screenshot.pinCount} 张 · 历史 ${runtimeHealth.historyCount} 条 · 临时图片 ${runtimeHealth.transientImageCount} 张 / ${(runtimeHealth.transientImageBytes / 1024 / 1024).toFixed(1)} MiB`}
                  </Text>
                </div>
              ) : (
                <Text type="secondary">正在读取本地运行统计…</Text>
              )}
            </div>
          </div>
          {runtimeHealth === null ? (
            <Spin size="small" />
          ) : (
            <span className={styles.status}>
              {runtimeHealth.screenshot.shortcuts.every((item) => item.registered)
                ? "运行正常"
                : "部分快捷键不可用"}
            </span>
          )}
        </div>
      </Card>

      <Card className={styles.surfaceCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionIdentity}>
            <span className={styles.surfaceIcon}>
              <ExclamationCircleOutlined />
            </span>
            <div>
              <Title level={5}>权限状态</Title>
              <Text type="secondary">
                应用或恢复映射时才会弹出 Windows UAC，主应用始终以普通权限运行。
              </Text>
            </div>
          </div>
          <span className={styles.status}>按需授权</span>
        </div>
      </Card>
    </div>
  );
}
