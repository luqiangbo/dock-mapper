import { describe, expect, it } from "vitest";
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  parseSidebarWidth,
} from "./sidebarPreferences";

describe("sidebar preferences", () => {
  it("clamps persisted widths to the supported range", () => {
    expect(parseSidebarWidth("120")).toBe(SIDEBAR_MIN_WIDTH);
    expect(parseSidebarWidth("260.4")).toBe(260);
    expect(parseSidebarWidth("900")).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("falls back when persisted data is invalid", () => {
    expect(parseSidebarWidth(null)).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(parseSidebarWidth("not-a-number")).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});
