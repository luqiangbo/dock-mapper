import { describe, expect, it } from "vitest";
import { historyDateRange, historyDatesFromRange, historyDateLocale } from "./historyDateRange";
describe("Ant Design 中文日期范围", () => {
  it("读取旧偏好后恢复日期，并使用中文选择器配置", () => {
    const range = historyDateRange({ startDate: "2026-10-16", endDate: "2026-10-17" });
    expect(historyDatesFromRange(range)).toEqual({
      startDate: "2026-10-16",
      endDate: "2026-10-17",
    });
    expect(range[0]?.locale()).toBe("zh-cn");
    expect(historyDateLocale.locale).toBe("zh-cn");
    expect(historyDateLocale.DatePicker?.lang.rangePlaceholder).toEqual(["开始日期", "结束日期"]);
  });
  it("支持单边日期和清除，同时保持本机日期格式", () => {
    expect(
      historyDatesFromRange(historyDateRange({ startDate: "", endDate: "2026-10-17" })),
    ).toEqual({ startDate: "", endDate: "2026-10-17" });
    expect(historyDatesFromRange(null)).toEqual({ startDate: "", endDate: "" });
  });
});
