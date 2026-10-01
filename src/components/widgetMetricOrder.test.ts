import { describe, expect, it } from "vitest";
import { canDisableMetric, finishMetricDrag, reorderVisibleMetrics } from "./widgetMetricOrder";
import type { WidgetMetricConfig, WidgetMetricKind } from "../types";
import { createQueuedAutosave, waitForPendingAutosave } from "../hooks/queuedAutosave";
const metrics: WidgetMetricConfig[] = [
  { kind: "network", enabled: true, usage_scheme: "capsule" },
  { kind: "battery", enabled: true, usage_scheme: "ring" },
  { kind: "memory", enabled: true, usage_scheme: "gauge" },
  { kind: "cpu", enabled: false, usage_scheme: "capsule" },
];
const visible: WidgetMetricKind[] = ["network", "memory", "cpu"];
describe("指标排序", () => {
  it("隐藏电池时拖动其他指标，保留电池位置及各指标样式", () => {
    const next = reorderVisibleMetrics(metrics, visible, "cpu", 0);
    expect(next.map((metric) => metric.kind)).toEqual(["cpu", "battery", "network", "memory"]);
    expect(next[1]).toBe(metrics[1]);
    expect(next[3].usage_scheme).toBe("gauge");
  });
  it("拖动取消或只点击手柄时不提交，完成拖动时提交一次新顺序", () => {
    expect(
      finishMetricDrag(metrics, visible, { kind: "cpu", targetIndex: 0, active: true }, true),
    ).toBe(metrics);
    expect(
      finishMetricDrag(metrics, visible, { kind: "cpu", targetIndex: 0, active: false }, false),
    ).toBe(metrics);
    expect(
      finishMetricDrag(metrics, visible, { kind: "cpu", targetIndex: 0, active: true }, false)[0]
        .kind,
    ).toBe("cpu");
  });
  it("最后一个可见启用指标不能关闭，即使隐藏电池启用", () => {
    const next = metrics.map((metric) =>
      metric.kind === "memory" ? { ...metric, enabled: false } : metric,
    );
    expect(canDisableMetric(next, visible, "network")).toBe(false);
    expect(canDisableMetric(next, visible, "cpu")).toBe(true);
  });
  it("排序保存失败后保留旧持久化值，重试后再次进入读取新顺序", async () => {
    let persisted = metrics;
    let failure = true;
    const errors: unknown[] = [];
    const queue = createQueuedAutosave<WidgetMetricConfig[], WidgetMetricConfig[]>({
      key: "metric-order-test",
      delayMs: 0,
      save: async (value) => {
        if (failure) throw new Error("写入失败");
        persisted = value;
        return value;
      },
      onSuccess: () => undefined,
      onError: (error) => errors.push(error),
      onDetachedError: (error) => errors.push(error),
      onSavingChange: () => undefined,
    });
    const next = reorderVisibleMetrics(metrics, visible, "cpu", 0);
    queue.schedule(next, 0);
    queue.detach();
    await waitForPendingAutosave("metric-order-test");
    expect(errors).toHaveLength(1);
    expect(persisted).toBe(metrics);
    failure = false;
    queue.attach();
    queue.schedule(next, 0);
    queue.detach();
    await waitForPendingAutosave("metric-order-test");
    expect(persisted.map((metric) => metric.kind)).toEqual(["cpu", "battery", "network", "memory"]);
  });
});
