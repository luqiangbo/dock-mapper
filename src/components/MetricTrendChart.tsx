import { memo, useEffect, useRef } from "react";
import { usePageActive } from "./PageActivity";
import * as echarts from "echarts/core";
import { LineChart, type LineSeriesOption } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  type GridComponentOption,
  type LegendComponentOption,
  type TooltipComponentOption,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { ComposeOption, EChartsType } from "echarts/core";
import { useTheme } from "../ThemeContext";
import { formatSpeed } from "../utils/format";
import type { DashboardSample } from "./dashboardTelemetry";
import styles from "./components.module.scss";
import { createSettledRenderQueue, windowResizeActivity } from "../windowResizeActivity";

echarts.use([
  LineChart,
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  SVGRenderer,
]);

type ChartOption = ComposeOption<
  LineSeriesOption | GridComponentOption | LegendComponentOption | TooltipComponentOption
>;
type SampleKey = "upload" | "download" | "cpu" | "memory";

interface SeriesDefinition {
  key: SampleKey;
  name: string;
  color: string;
}

function MetricTrendChart({
  title,
  samples,
  series,
  percent = false,
}: {
  title: string;
  samples: DashboardSample[];
  series: SeriesDefinition[];
  percent?: boolean;
}) {
  const active = usePageActive();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const { resolved } = useTheme();

  const latest = useRef({ title, samples, series, percent, resolved });
  latest.current = { title, samples, series, percent, resolved };
  const renderQueue = useRef<ReturnType<typeof createSettledRenderQueue> | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container, undefined, { renderer: "svg" });
    chartRef.current = chart;
    let previousWidth = container.clientWidth;
    let previousHeight = container.clientHeight;
    const queue = createSettledRenderQueue(windowResizeActivity, () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      const { title, samples, series, percent, resolved } = latest.current;
      const textColor = resolved === "dark" ? "#b6bdc7" : "#59636f";
      const lineColor = resolved === "dark" ? "#414750" : "#dce1e7";
      const option: ChartOption = {
        animation: false,
        aria: { enabled: true, description: `${title}动态折线图` },
        color: series.map((item) => item.color),
        grid: { left: 12, right: 12, top: 34, bottom: 8, containLabel: true },
        legend: { top: 0, right: 0, textStyle: { color: textColor, fontSize: 11 } },
        tooltip: {
          trigger: "axis",
          valueFormatter: (value) =>
            percent ? `${Number(value).toFixed(1)}%` : formatSpeed(Number(value)),
        },
        xAxis: {
          type: "time",
          axisLabel: { color: textColor, hideOverlap: true },
          axisLine: { lineStyle: { color: lineColor } },
          splitLine: { show: false },
        },
        yAxis: {
          type: "value",
          min: 0,
          max: percent ? 100 : undefined,
          axisLabel: {
            color: textColor,
            formatter: (value: number) => (percent ? `${value}%` : formatSpeed(value)),
          },
          splitLine: { lineStyle: { color: lineColor } },
        },
        series: series.map((item) => ({
          name: item.name,
          data: samples.map((sample) => [sample.timestamp, sample[item.key]]),
          type: "line",
          showSymbol: false,
          connectNulls: false,
          smooth: 0.22,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.06 },
        })),
      };

      // Let resize consume the pending option so final geometry and data paint together.
      chart.setOption(option, { lazyUpdate: true });
      if (width !== previousWidth || height !== previousHeight) {
        previousWidth = width;
        previousHeight = height;
        chart.resize({ width, height, animation: { duration: 0 } });
      }
    });
    renderQueue.current = queue;
    const observer = new ResizeObserver(() => {
      if (container.clientWidth === previousWidth && container.clientHeight === previousHeight)
        return;
      windowResizeActivity.begin();
      queue.request();
    });
    observer.observe(container);
    queue.request();
    return () => {
      observer.disconnect();
      queue.dispose();
      renderQueue.current = null;
      chartRef.current = null;
      chart.dispose();
    };
  }, [active]);

  useEffect(() => {
    renderQueue.current?.request();
  }, [samples, series, percent, resolved, title, active]);

  return <div ref={containerRef} className={styles.trendChart} role="img" aria-label={title} />;
}
export default memo(MetricTrendChart);
