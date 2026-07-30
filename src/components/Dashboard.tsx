import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Banner, Button, Card, Spin, Typography } from "@douyinfe/semi-ui";
import {
  IconAlertCircle,
  IconArrowDown,
  IconArrowUp,
  IconKey,
  IconLive,
} from "@douyinfe/semi-icons";
import type { EngineStatus, SysStatus } from "../types";
import { formatSpeed } from "../utils/format";
import styles from "./components.module.css";

const { Text, Title } = Typography;

export default function Dashboard() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [sysStatus, setSysStatus] = useState<SysStatus>({
    upload_speed: 0,
    download_speed: 0,
    memory_usage: 0,
  });

  useEffect(() => {
    void invoke<boolean>("check_is_admin").then(setIsAdmin).catch(() => setIsAdmin(false));
    void invoke<EngineStatus>("get_engine_status").then(setEngine).catch(() => {
      setEngine({ running: false, enabled: false, last_error: "读取引擎状态失败" });
    });

    const statusListener = listen<SysStatus>("sys-status-update", (event) => {
      setSysStatus(event.payload);
    });
    const engineListener = listen<EngineStatus>("engine-status-changed", (event) => {
      setEngine(event.payload);
    });

    return () => {
      void statusListener.then((unlisten) => unlisten());
      void engineListener.then((unlisten) => unlisten());
    };
  }, []);

  const engineClass = engine?.last_error
    ? `${styles.status} ${styles.error}`
    : engine?.running && engine.enabled
      ? `${styles.status} ${styles.running}`
      : styles.status;
  const engineLabel = engine?.last_error
    ? "启动异常"
    : !engine?.running
      ? "未运行"
      : engine.enabled
        ? "运行中"
        : "已暂停";

  return (
    <div className={styles.page}>
      {!isAdmin && isAdmin !== null && (
        <Card className={styles.glassCard}>
          <div className={styles.adminAction}>
            <Banner
              type="warning"
              closeIcon={null}
              title="当前为普通用户权限"
              description="高权限窗口中的按键映射可能不生效。"
            />
            <Button
              theme="solid"
              type="warning"
              onClick={() => void invoke("relaunch_as_admin")}
            >
              以管理员身份重启
            </Button>
          </div>
        </Card>
      )}

      <div className={styles.overviewGrid}>
        <Card className={styles.glassCard}>
          <div className={styles.metric}>
            <span className={styles.metricIcon}><IconArrowUp /></span>
            <div>
              <Text type="secondary">实时上传</Text>
              <span className={styles.metricValue}>{formatSpeed(sysStatus.upload_speed)}</span>
            </div>
          </div>
        </Card>
        <Card className={styles.glassCard}>
          <div className={styles.metric}>
            <span className={styles.metricIcon}><IconArrowDown /></span>
            <div>
              <Text type="secondary">实时下载</Text>
              <span className={styles.metricValue}>{formatSpeed(sysStatus.download_speed)}</span>
            </div>
          </div>
        </Card>
        <Card className={styles.glassCard}>
          <div className={styles.metric}>
            <span className={styles.metricIcon}><IconLive /></span>
            <div>
              <Text type="secondary">内存占用</Text>
              <span className={styles.metricValue}>{sysStatus.memory_usage.toFixed(0)}%</span>
            </div>
          </div>
        </Card>
      </div>

      <Card className={styles.surfaceCard}>
        <div className={styles.sectionHeader}>
          <Title heading={6}><IconKey /> 键盘映射引擎</Title>
          {engine === null ? <Spin size="small" /> : <span className={engineClass}>{engineLabel}</span>}
        </div>
        <Text type="secondary">
          {engine?.last_error ??
            (engine?.enabled
              ? "原生 Windows 低级键盘钩子已就绪，注入事件会被自动忽略。"
              : "映射规则已保留，重新启用后立即生效。")}
        </Text>
      </Card>

      <Card className={styles.surfaceCard}>
        <div className={styles.sectionHeader}>
          <Title heading={6}><IconAlertCircle /> 权限状态</Title>
          {isAdmin === null ? (
            <Spin size="small" />
          ) : (
            <span className={`${styles.status} ${isAdmin ? styles.running : ""}`}>
              {isAdmin ? "管理员权限" : "普通用户权限"}
            </span>
          )}
        </div>
        <Text type="secondary">
          管理员权限仅用于让映射覆盖高权限窗口；其他功能可在普通权限下使用。
        </Text>
      </Card>
    </div>
  );
}
