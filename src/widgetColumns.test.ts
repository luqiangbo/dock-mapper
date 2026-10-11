import { describe, expect, it } from "vitest";
import type { WidgetMetricConfig, WidgetMetricKind } from "./types";
import { buildWidgetColumns, describeWidgetColumns, pairWidgetMetrics } from "./widgetColumns";

const metric = (
  kind: WidgetMetricKind,
  partner: WidgetMetricKind | null = null,
): WidgetMetricConfig => ({
  kind,
  pair_with: partner,
  enabled: true,
  row_layout: "single",
  icon_style: "text",
  usage_scheme: "number",
});

describe("independent widget columns", () => {
  it("pairs arbitrary complete metrics and keeps unpaired metrics in their own columns", () => {
    const columns = buildWidgetColumns([
      metric("cpu", "upload"),
      metric("memory"),
      metric("upload", "cpu"),
      metric("download"),
    ]);
    expect(columns.map((c) => c.map((m) => m.kind))).toEqual([
      ["cpu", "upload"],
      ["memory"],
      ["download"],
    ]);
    expect(describeWidgetColumns(columns, 1)).toEqual({
      visibleKinds: ["cpu", "upload"],
      hiddenKinds: ["memory", "download"],
    });
  });
  it("releases both previous partners before making a new two-row column", () => {
    const next = pairWidgetMetrics(
      [
        metric("cpu", "memory"),
        metric("memory", "cpu"),
        metric("upload", "download"),
        metric("download", "upload"),
      ],
      "cpu",
      "upload",
    );
    expect(next.map((m) => m.pair_with)).toEqual(["upload", null, "cpu", null]);
    expect(buildWidgetColumns(next).every((c) => c.length <= 2)).toBe(true);
    expect(buildWidgetColumns(pairWidgetMetrics(next, "cpu", null)).length).toBe(4);
  });
  it("uses metric order for upper/lower order and does not reserve space for an unavailable partner", () => {
    expect(
      buildWidgetColumns([metric("download", "upload"), metric("upload", "download")])[0].map(
        (m) => m.kind,
      ),
    ).toEqual(["download", "upload"]);
    expect(buildWidgetColumns([metric("cpu", "battery")])).toEqual([[metric("cpu", "battery")]]);
  });
});
