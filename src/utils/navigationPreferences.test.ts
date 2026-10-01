import { describe, expect, it } from "vitest";
import { isMainNavigation, parseNavigationPreferences } from "./navigationPreferences";
describe("重新打开配置中心", () => {
  it("首次使用和损坏偏好进入仪表盘", () => {
    for (const raw of [null, "bad", "null", '{"page":"unknown","tab":"history"}']) {
      expect(parseNavigationPreferences(raw)).toEqual({ page: "dashboard", tab: "history" });
    }
  });
  it("恢复截图设置标签", () => {
    expect(parseNavigationPreferences('{"page":"screenshot","tab":"settings"}')).toEqual({
      page: "screenshot",
      tab: "settings",
    });
  });
  it("接受外部截图入口并拒绝未知页面", () => {
    expect(isMainNavigation({ page: "screenshot", tab: "history" })).toBe(true);
    expect(isMainNavigation({ page: "unknown" } as never)).toBe(false);
  });
});
