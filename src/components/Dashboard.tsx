import { useMemo, useState, type ReactNode } from "react";
import { Card, Col, Grid, Row, Segmented, Spin, Typography } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DashboardOutlined } from "@ant-design/icons";
import RuntimeLogPanel from "./RuntimeLogPanel";
import type { SysStatus } from "../types";
import { formatSpeed } from "../utils/format";
import MetricTrendChart from "./MetricTrendChart";
import type { DashboardSample } from "./dashboardTelemetry";
import { selectTelemetryArchive, type TrendRange } from "./telemetryArchive";
import type { TelemetryFreshness } from "../utils/telemetryFreshness";
import styles from "./components.module.scss";
import { useTheme } from "../ThemeContext";
import { accentColors, themePalettes } from "../themePalette";

const { Text, Title } = Typography;

interface Props {
  status: SysStatus | null;
  freshness: TelemetryFreshness;
  samples: DashboardSample[];
  archive: DashboardSample[];
}

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <Card className={styles.glassCard}>
      <div className={styles.metric}>
        <span className={styles.metricIcon}>{icon}</span>
        <div>
          <Text type="secondary">{label}</Text>
          <span className={styles.metricValue}>{value}</span>
        </div>
      </div>
    </Card>
  );
}

export default function Dashboard({ status, freshness, samples, archive }: Props) {
  const { accentColor, resolved } = useTheme();
  const chartColor = accentColors(accentColor, resolved).foreground;
  const secondaryColor = themePalettes[resolved]["chart-secondary"];
  const warmColor = themePalettes[resolved]["chart-warm"];
  const networkSeries = useMemo(
    () => [
      { key: "upload" as const, name: "上传", color: warmColor },
      { key: "download" as const, name: "下载", color: chartColor },
    ],
    [chartColor, warmColor],
  );
  const resourceSeries = useMemo(
    () => [
      { key: "cpu" as const, name: "CPU", color: chartColor },
      { key: "memory" as const, name: "内存", color: secondaryColor },
    ],
    [chartColor, secondaryColor],
  );
  const screens = Grid.useBreakpoint();
  const gutter: [number, number] = [screens.lg ? 16 : 12, 12];
  const [trendRange, setTrendRange] = useState<TrendRange>("live");
  const archiveSamples = useMemo(
    () => (trendRange === "live" ? [] : selectTelemetryArchive(archive, trendRange, Date.now())),
    [archive, trendRange],
  );
  const trendSamples = trendRange === "live" ? samples : archiveSamples;
  const trendLabel =
    trendRange === "live" ? "最近 5 分钟" : trendRange === "hour" ? "最近 1 小时" : "最近 24 小时";
  return (
    <div className={styles.page}>
      <section className={styles.dashboardHero}>
        <div>
          <Title level={3}>系统概览</Title>
          <Text type="secondary">系统指标与本机运行日志</Text>
        </div>
        <span className={styles.liveBadge}>
          <i />
          {freshness === "live" ? "实时更新" : freshness === "stale" ? "数据已过期" : "等待采样"}
        </span>
      </section>
      <Row gutter={gutter}>
        <Col xs={24} sm={12} lg={6}>
          <MetricCard
            icon={<ArrowUpOutlined />}
            label={
              !status ? "实时上传" : status.network_available ? "实时上传" : "上传（网卡不可用）"
            }
            value={status?.network_available ? formatSpeed(status.upload_speed) : "—"}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <MetricCard
            icon={<ArrowDownOutlined />}
            label={
              !status ? "实时下载" : status.network_available ? "实时下载" : "下载（网卡不可用）"
            }
            value={status?.network_available ? formatSpeed(status.download_speed) : "—"}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <MetricCard
            icon={<DashboardOutlined />}
            label="CPU 占用"
            value={status?.cpu_usage == null ? "—" : `${status.cpu_usage.toFixed(0)}%`}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <MetricCard
            icon={<DashboardOutlined />}
            label="内存占用"
            value={status == null ? "—" : `${status.memory_usage.toFixed(0)}%`}
          />
        </Col>
        {status?.battery && (
          <Col xs={24} sm={12} lg={6}>
            <MetricCard
              icon={<DashboardOutlined />}
              label={status.battery.charging ? "电池（充电中）" : "电池"}
              value={`${status.battery.percentage.toFixed(0)}%`}
            />
          </Col>
        )}
      </Row>
      <Segmented<TrendRange>
        value={trendRange}
        onChange={setTrendRange}
        options={[
          { label: "5 分钟", value: "live" },
          { label: "1 小时", value: "hour" },
          { label: "24 小时", value: "day" },
        ]}
        aria-label="趋势时间范围"
      />
      {trendRange !== "live" && (
        <Text type="secondary">应用运行时按分钟保存在本机；退出后的时段显示断点。</Text>
      )}
      <Row gutter={gutter}>
        <Col xs={24} lg={12}>
          <Card className={styles.surfaceCard} title={`网络趋势 · ${trendLabel}`}>
            {trendSamples.length < 2 ? (
              <div className={styles.chartEmpty}>
                {trendRange === "live" && <Spin size="small" />}
                <Text type="secondary">该时间范围暂无足够采样</Text>
              </div>
            ) : (
              <MetricTrendChart
                title={`${trendLabel}网络趋势`}
                samples={trendSamples}
                series={networkSeries}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card className={styles.surfaceCard} title={`资源趋势 · ${trendLabel}`}>
            {trendSamples.length < 2 ? (
              <div className={styles.chartEmpty}>
                {trendRange === "live" && <Spin size="small" />}
                <Text type="secondary">该时间范围暂无足够采样</Text>
              </div>
            ) : (
              <MetricTrendChart
                title={`${trendLabel}资源趋势`}
                samples={trendSamples}
                series={resourceSeries}
                percent
              />
            )}
          </Card>
        </Col>
      </Row>
      <RuntimeLogPanel />
    </div>
  );
}
