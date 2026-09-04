import { useEffect, useRef } from "react";
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

echarts.use([LineChart, AriaComponent, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

type ChartOption = ComposeOption<LineSeriesOption | GridComponentOption | LegendComponentOption | TooltipComponentOption>;
type SampleKey = "upload" | "download" | "cpu" | "memory";

interface SeriesDefinition {
  key: SampleKey;
  name: string;
  color: string;
}

export default function MetricTrendChart({
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
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const { resolved } = useTheme();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container, undefined, { renderer: "svg" });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      chartRef.current = null;
      chart.dispose();
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const textColor = resolved === "dark" ? "#aeb9d4" : "#5f6b82";
    const lineColor = resolved === "dark" ? "rgba(191,209,255,.15)" : "rgba(95,107,130,.16)";
    const option: ChartOption = {
      animation: false,
      aria: { enabled: true, description: `${title}，最近五分钟动态折线图` },
      color: series.map((item) => item.color),
      grid: { left: 12, right: 12, top: 34, bottom: 8, containLabel: true },
      legend: { top: 0, right: 0, textStyle: { color: textColor, fontSize: 11 } },
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => percent ? `${Number(value).toFixed(1)}%` : formatSpeed(Number(value)),
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
          formatter: (value: number) => percent ? `${value}%` : formatSpeed(value),
        },
        splitLine: { lineStyle: { color: lineColor } },
      },
      series: series.map((item) => ({
        name: item.name,
        type: "line",
        showSymbol: false,
        connectNulls: false,
        smooth: 0.22,
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.06 },
        data: samples.map((sample) => [sample.timestamp, sample[item.key]]),
      })),
    };
    chart.setOption(option, { notMerge: true });
  }, [percent, resolved, samples, series, title]);

  return <div ref={containerRef} className={styles.trendChart} role="img" aria-label={title} />;
}
