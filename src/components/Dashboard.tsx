import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button, Card, Spin, Typography } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DashboardOutlined,
  ExclamationCircleOutlined,
  KeyOutlined,
} from "@ant-design/icons";
import type { ScancodeMapStatus, SysStatus } from "../types";
import { formatSpeed } from "../utils/format";
import styles from "./components.module.scss";

const { Text, Title } = Typography;

export default function Dashboard() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [mapStatus, setMapStatus] = useState<ScancodeMapStatus | null>(null);
  const [sysStatus, setSysStatus] = useState<SysStatus>({
    upload_speed: 0,
    download_speed: 0,
    memory_usage: 0,
  });

  useEffect(() => {
    void invoke<boolean>("check_is_admin")
      .then(setIsAdmin)
      .catch(() => setIsAdmin(false));
    const refreshMapStatus = () =>
      invoke<ScancodeMapStatus>("get_scancode_map_status")
        .then(setMapStatus)
        .catch(() => setMapStatus(null));
    void refreshMapStatus();

    const statusListener = listen<SysStatus>("sys-status-update", (event) => {
      setSysStatus(event.payload);
    });
    const mapListener = listen("scancode-map-changed", () => void refreshMapStatus());

    return () => {
      void statusListener.then((unlisten) => unlisten());
      void mapListener.then((unlisten) => unlisten());
    };
  }, []);

  const mappingLabel = !mapStatus
    ? "状态未知"
    : mapStatus.requires_restart
      ? "等待重启生效"
      : mapStatus.applied
        ? "已写入系统"
        : mapStatus.has_external_map
          ? "检测到外部映射"
          : "尚未应用";
  const mappingDescription = !mapStatus
    ? "无法读取系统扫描码映射状态。"
    : mapStatus.has_external_map
      ? "系统中存在其他工具写入的 Scancode Map，接管前会先备份。"
      : mapStatus.applied
        ? mapStatus.requires_restart
          ? "映射已安全写入注册表，重新登录或重启 Windows 后生效。"
          : "DockMapper 的 Scancode Map 已存在于系统注册表。"
        : mapStatus.backup_available
          ? "当前未应用 DockMapper 映射，可恢复接管前的系统映射。"
          : "在按键映射页配置规则并应用到系统。";

  return (
    <div className={styles.page}>
      <section className={styles.overviewPanel}>
        {!isAdmin && isAdmin !== null && (
          <div className={styles.adminNotice} role="status">
            <span className={styles.warningIcon}>
              <ExclamationCircleOutlined />
            </span>
            <div className={styles.adminCopy}>
              <strong>当前为普通用户权限</strong>
              <Text type="secondary">应用或恢复系统 Scancode Map 时需要管理员权限。</Text>
            </div>
            <Button
              className={styles.adminButton}
              type="default"
              onClick={() => void invoke("relaunch_as_admin")}
            >
              以管理员身份重启
            </Button>
          </div>
        )}

        <div className={styles.overviewGrid}>
          <Card className={styles.glassCard}>
            <div className={styles.metric}>
              <span className={styles.metricIcon}>
                <ArrowUpOutlined />
              </span>
              <div>
                <Text type="secondary">实时上传</Text>
                <span className={styles.metricValue}>{formatSpeed(sysStatus.upload_speed)}</span>
              </div>
            </div>
          </Card>
          <Card className={styles.glassCard}>
            <div className={styles.metric}>
              <span className={styles.metricIcon}>
                <ArrowDownOutlined />
              </span>
              <div>
                <Text type="secondary">实时下载</Text>
                <span className={styles.metricValue}>{formatSpeed(sysStatus.download_speed)}</span>
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
            <span className={`${styles.status} ${mapStatus.applied ? styles.running : ""}`}>
              {mappingLabel}
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
              <Text type="secondary">管理员权限仅用于写入或恢复系统 Scancode Map。</Text>
            </div>
          </div>
          {isAdmin === null ? (
            <Spin size="small" />
          ) : (
            <span className={`${styles.status} ${isAdmin ? styles.running : ""}`}>
              {isAdmin ? "管理员权限" : "普通用户权限"}
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}
