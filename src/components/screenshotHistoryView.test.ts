import { describe, expect, it } from "vitest";
import type { ScreenshotHistorySummary } from "../screenshots/screenshot/api";
import {
  DEFAULT_SCREENSHOT_HISTORY_VIEW,
  parseScreenshotHistoryView,
  selectScreenshotHistory,
} from "./screenshotHistoryView";

const entries: ScreenshotHistorySummary[] = [
  { id: "old", createdAtMs: 1, width: 1, height: 1, favorite: false, totalBytes: 1 },
  { id: "favorite", createdAtMs: 2, width: 1, height: 1, favorite: true, totalBytes: 1 },
  { id: "new", createdAtMs: 3, width: 1, height: 1, favorite: false, totalBytes: 1 },
];

describe("screenshot history view", () => {
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
      selectScreenshotHistory(entries, { ...DEFAULT_SCREENSHOT_HISTORY_VIEW, sort: "favorite" }).map(
        ({ id }) => id,
      ),
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
      parseScreenshotHistoryView(
        JSON.stringify({ sort: "oldest", filter: "invalid", density: "large" }),
      ),
    ).toEqual({ sort: "oldest", filter: "all", density: "large" });
    expect(parseScreenshotHistoryView("not-json")).toEqual(DEFAULT_SCREENSHOT_HISTORY_VIEW);
  });
});
