import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button, Select, Switch, Tooltip } from "antd";
import { HolderOutlined, ArrowUpOutlined, ArrowDownOutlined } from "@ant-design/icons";
import type { WidgetMetricConfig, WidgetMetricKind } from "../types";
import {
  canDisableMetric,
  finishMetricDrag,
  reorderVisibleMetrics,
  type MetricDrag,
} from "./widgetMetricOrder";
import styles from "./components.module.scss";

const labels = { network: "网速", cpu: "CPU", memory: "内存", battery: "电池" };
const schemes = [
  { value: "capsule", label: "紧凑" },
  { value: "ring", label: "圆环" },
  { value: "gauge", label: "刻度" },
];

export function WidgetMetricList({
  metrics,
  batteryAvailable,
  onChange,
}: {
  metrics: WidgetMetricConfig[];
  batteryAvailable: boolean;
  onChange: (metrics: WidgetMetricConfig[]) => void;
}) {
  const visible = metrics.filter((metric) => batteryAvailable || metric.kind !== "battery");
  const kinds = visible.map((metric) => metric.kind);
  const [drag, setDrag] = useState<MetricDrag | null>(null);
  const dragRef = useRef<MetricDrag | null>(null);
  const activePointer = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const pointer = useRef({ x: 0, y: 0 });
  const host = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    const cancel = () => {
      dragRef.current = null;
      activePointer.current = null;
      setDrag(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  const commit = (next: WidgetMetricConfig[], kind: WidgetMetricKind) => {
    if (next === metrics) return;
    onChange(next);
    const position =
      next
        .filter((metric) => kinds.includes(metric.kind))
        .findIndex((metric) => metric.kind === kind) + 1;
    setAnnouncement(`${labels[kind]}已移至第 ${position} 位，等待保存`);
  };
  const updateTarget = () => {
    const current = dragRef.current;
    if (!current || !host.current) return;
    const rows = [...host.current.querySelectorAll<HTMLElement>("[data-metric-row]")];
    const from = kinds.indexOf(current.kind);
    let insertion = rows.findIndex(
      (row) => pointer.current.y < row.getBoundingClientRect().top + row.offsetHeight / 2,
    );
    if (insertion < 0) insertion = rows.length;
    const targetIndex = Math.max(
      0,
      Math.min(rows.length - 1, insertion > from ? insertion - 1 : insertion),
    );
    if (targetIndex !== current.targetIndex) {
      dragRef.current = { ...current, targetIndex };
      setDrag(dragRef.current);
    }
  };
  useEffect(() => {
    if (!drag?.active) return;
    let frame = 0;
    const scroll = () => {
      let ancestor = host.current?.parentElement;
      while (
        ancestor &&
        !(
          ancestor.scrollHeight > ancestor.clientHeight &&
          /auto|scroll/.test(getComputedStyle(ancestor).overflowY)
        )
      )
        ancestor = ancestor.parentElement;
      if (ancestor) {
        const rect = ancestor.getBoundingClientRect();
        const y = pointer.current.y;
        const delta = y < rect.top + 40 ? -8 : y > rect.bottom - 40 ? 8 : 0;
        if (delta) {
          ancestor.scrollTop += delta;
          updateTarget();
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [drag?.active, metrics, batteryAvailable]);
  const finish = (cancelled: boolean) => {
    const current = dragRef.current;
    dragRef.current = null;
    activePointer.current = null;
    setDrag(null);
    if (current) commit(finishMetricDrag(metrics, kinds, current, cancelled), current.kind);
  };
  const start = (event: PointerEvent<HTMLElement>, kind: WidgetMetricKind) => {
    if (event.button !== 0 || activePointer.current !== null) return;
    activePointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = pointer.current = { x: event.clientX, y: event.clientY };
    dragRef.current = { kind, targetIndex: kinds.indexOf(kind), active: false };
  };
  return (
    <div ref={host} className={styles.metricList}>
      <div className={styles.metricListHeading}>
        展示指标 <span>拖动手柄调整顺序</span>
      </div>
      {visible.map((metric, index) => (
        <div
          key={metric.kind}
          data-metric-row
          className={`${styles.metricSettingRow} ${drag?.active && drag.kind === metric.kind ? styles.metricDragging : ""} ${drag?.active && drag.targetIndex === index ? `${styles.metricDropTarget} ${index > kinds.indexOf(drag.kind) ? styles.metricDropTargetAfter : ""}` : ""}`}
        >
          <Button
            type="text"
            icon={<HolderOutlined />}
            className={styles.metricDragHandle}
            aria-label={`拖动${labels[metric.kind]}排序`}
            onPointerDown={(event) => start(event, metric.kind)}
            onPointerMove={(event) => {
              if (!dragRef.current || activePointer.current !== event.pointerId) return;
              pointer.current = { x: event.clientX, y: event.clientY };
              if (
                !dragRef.current.active &&
                Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) >= 5
              ) {
                dragRef.current = { ...dragRef.current, active: true };
                setDrag(dragRef.current);
              }
              if (dragRef.current.active) updateTarget();
            }}
            onPointerUp={(event) => {
              if (activePointer.current === event.pointerId) finish(false);
            }}
            onPointerCancel={(event) => {
              if (activePointer.current === event.pointerId) finish(true);
            }}
            onLostPointerCapture={(event) => {
              if (activePointer.current === event.pointerId) finish(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") finish(true);
            }}
          />
          <strong className={styles.metricName}>{labels[metric.kind]}</strong>
          <Tooltip
            title={
              canDisableMetric(metrics, kinds, metric.kind) ? undefined : "至少保留一个展示指标"
            }
          >
            <span>
              <Switch
                checked={metric.enabled}
                disabled={!canDisableMetric(metrics, kinds, metric.kind)}
                aria-label={`启用${labels[metric.kind]}`}
                onChange={(enabled) =>
                  onChange(
                    metrics.map((item) =>
                      item.kind === metric.kind ? { ...item, enabled } : item,
                    ),
                  )
                }
              />
            </span>
          </Tooltip>
          {metric.kind === "network" ? (
            <span className={styles.metricScheme}>双行网速</span>
          ) : (
            <Select
              className={styles.metricScheme}
              aria-label={`${labels[metric.kind]}展示样式`}
              value={metric.usage_scheme}
              disabled={!metric.enabled}
              options={schemes}
              onChange={(usage_scheme) =>
                onChange(
                  metrics.map((item) =>
                    item.kind === metric.kind ? { ...item, usage_scheme } : item,
                  ),
                )
              }
            />
          )}
          <div className={styles.metricMoveActions}>
            <Button
              aria-label={`${labels[metric.kind]}上移`}
              icon={<ArrowUpOutlined />}
              disabled={index === 0}
              onClick={() =>
                commit(reorderVisibleMetrics(metrics, kinds, metric.kind, index - 1), metric.kind)
              }
            />
            <Button
              aria-label={`${labels[metric.kind]}下移`}
              icon={<ArrowDownOutlined />}
              disabled={index === visible.length - 1}
              onClick={() =>
                commit(reorderVisibleMetrics(metrics, kinds, metric.kind, index + 1), metric.kind)
              }
            />
          </div>
        </div>
      ))}
      {!visible.length && <p>暂无可配置指标</p>}
      {visible.filter((metric) => metric.enabled).length === 1 && (
        <p className={styles.description}>至少保留一个展示指标；启用其他指标后，可关闭当前指标。</p>
      )}
      <span className={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
