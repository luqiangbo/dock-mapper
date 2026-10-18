import { describe, expect, it } from "vitest";
import type { ScreenshotHistorySummary } from "../screenshots/screenshot/api";
import {
  DEFAULT_SCREENSHOT_HISTORY_VIEW,
  parseScreenshotHistoryView,
  responsiveHistoryColumnCount,
  selectScreenshotHistory,
  screenshotHistoryPhase,
  groupScreenshotHistory,
  localDateKey,
} from "./screenshotHistoryView";

const entries: ScreenshotHistorySummary[] = [
  { id: "old", createdAtMs: 1, width: 1, height: 1, favorite: false, totalBytes: 1 },
  { id: "favorite", createdAtMs: 2, width: 1, height: 1, favorite: true, totalBytes: 1 },
  { id: "new", createdAtMs: 3, width: 1, height: 1, favorite: false, totalBytes: 1 },
];

describe("screenshot history view", () => {
  it("按本机日期分组，并包含起止日期当天的全部记录", () => {
    const records = [
      new Date(2026, 9, 16, 23, 59),
      new Date(2026, 9, 17, 0, 0),
      new Date(2026, 9, 17, 23, 59),
      new Date(2026, 9, 18, 0, 0),
    ].map((date, index) => ({ ...entries[0], id: String(index), createdAtMs: date.getTime() }));
    const result = selectScreenshotHistory(records, {
      ...DEFAULT_SCREENSHOT_HISTORY_VIEW,
      startDate: "2026-10-17",
      endDate: "2026-10-17",
    });
    expect(result.map((entry) => entry.id)).toEqual(["2", "1"]);
    expect(
      groupScreenshotHistory(result).map((group) => [group.date, group.entries.length]),
    ).toEqual([["2026-10-17", 2]]);
    expect(localDateKey(records[0].createdAtMs)).toBe("2026-10-16");
  });
  it("收藏排序在日期组内生效，日期组顺序仍然明确", () => {
    const records = [
      { ...entries[0], createdAtMs: new Date(2026, 9, 17).getTime() },
      { ...entries[1], createdAtMs: new Date(2026, 9, 16).getTime() },
    ];
    expect(
      selectScreenshotHistory(records, {
        ...DEFAULT_SCREENSHOT_HISTORY_VIEW,
        sort: "favorite",
      }).map((entry) => entry.id),
    ).toEqual(["old", "favorite"]);
  });
  it("迁移旧偏好，非法或反向日期范围恢复为不限日期", () => {
    const saved = {
      ...DEFAULT_SCREENSHOT_HISTORY_VIEW,
      startDate: "2026-10-16",
      endDate: "2026-10-17",
      filter: "favorite" as const,
    };
    expect(parseScreenshotHistoryView(JSON.stringify(saved))).toEqual(saved);
    expect(
      parseScreenshotHistoryView(JSON.stringify({ startDate: "2026-02-30", endDate: "2026-10-17" }))
        .startDate,
    ).toBe("");
    expect(
      parseScreenshotHistoryView(
        JSON.stringify({ startDate: "2026-10-18", endDate: "2026-10-17" }),
      ),
    ).toMatchObject({ startDate: "", endDate: "" });
  });
  it("首次读取失败显示错误，重试后可进入空历史", () => {
    expect(screenshotHistoryPhase(true, null, 0, 0)).toBe("loading");
    expect(screenshotHistoryPhase(false, "读取失败", 0, 0)).toBe("error");
    expect(screenshotHistoryPhase(false, null, 0, 0)).toBe("empty");
  });
  it("后台刷新与刷新失败保留已有截图，收藏筛选为空有独立状态", () => {
    expect(screenshotHistoryPhase(true, null, 3, 3)).toBe("ready");
    expect(screenshotHistoryPhase(false, "刷新失败", 3, 3)).toBe("ready");
    expect(screenshotHistoryPhase(false, null, 3, 0)).toBe("filtered");
  });
  it("sorts newest, oldest and favorites deterministically", () => {
    expect(
      selectScreenshotHistory(entries, { ...DEFAULT_SCREENSHOT_HISTORY_VIEW, sort: "newest" }).map(
        ({ id }) => id,
      ),
    ).toEqual(["new", "favorite", "old"]);
    expect(
      selectScreenshotHistory(entries, { ...DEFAULT_SCREENSHOT_HISTORY_VIEW, sort: "oldest" }).map(
        ({ id }) => id,
      ),
    ).toEqual(["old", "favorite", "new"]);
    expect(
      selectScreenshotHistory(entries, {
        ...DEFAULT_SCREENSHOT_HISTORY_VIEW,
        sort: "favorite",
      }).map(({ id }) => id),
    ).toEqual(["favorite", "new", "old"]);
  });

  it("filters favorites without changing the source list", () => {
    expect(
      selectScreenshotHistory(entries, {
        ...DEFAULT_SCREENSHOT_HISTORY_VIEW,
        filter: "favorite",
      }).map(({ id }) => id),
    ).toEqual(["favorite"]);
    expect(entries.map(({ id }) => id)).toEqual(["old", "favorite", "new"]);
  });

  it("validates every stored preference and falls back after corruption", () => {
    expect(
      parseScreenshotHistoryView(JSON.stringify({ sort: "oldest", filter: "invalid", columns: 7 })),
    ).toEqual({ ...DEFAULT_SCREENSHOT_HISTORY_VIEW, sort: "oldest", filter: "all", columns: 7 });
    expect(parseScreenshotHistoryView(JSON.stringify({ columns: 0 }))).toEqual(
      DEFAULT_SCREENSHOT_HISTORY_VIEW,
    );
    expect(parseScreenshotHistoryView("not-json")).toEqual(DEFAULT_SCREENSHOT_HISTORY_VIEW);
  });

  it("migrates the previous density preference to a matching column count", () => {
    expect(parseScreenshotHistoryView(JSON.stringify({ density: "compact" })).columns).toBe(4);
    expect(parseScreenshotHistoryView(JSON.stringify({ density: "standard" })).columns).toBe(3);
    expect(parseScreenshotHistoryView(JSON.stringify({ density: "large" })).columns).toBe(2);
  });

  it("limits visible masonry columns without changing the user's desktop preference", () => {
    expect(responsiveHistoryColumnCount(8, {})).toBe(1);
    expect(responsiveHistoryColumnCount(8, { sm: true })).toBe(2);
    expect(responsiveHistoryColumnCount(8, { sm: true, lg: true })).toBe(8);
  });
});
