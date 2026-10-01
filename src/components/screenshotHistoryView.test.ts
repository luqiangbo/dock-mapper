import { describe, expect, it } from "vitest";
import type { ScreenshotHistorySummary } from "../screenshots/screenshot/api";
import {
  DEFAULT_SCREENSHOT_HISTORY_VIEW,
  parseScreenshotHistoryView,
  responsiveHistoryColumnCount,
  selectScreenshotHistory,
  screenshotHistoryPhase,
} from "./screenshotHistoryView";

const entries: ScreenshotHistorySummary[] = [
  { id: "old", createdAtMs: 1, width: 1, height: 1, favorite: false, totalBytes: 1 },
  { id: "favorite", createdAtMs: 2, width: 1, height: 1, favorite: true, totalBytes: 1 },
  { id: "new", createdAtMs: 3, width: 1, height: 1, favorite: false, totalBytes: 1 },
];

describe("screenshot history view", () => {
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
    ).toEqual({ sort: "oldest", filter: "all", columns: 7 });
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
