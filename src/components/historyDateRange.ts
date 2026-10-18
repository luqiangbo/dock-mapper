import dayjs, { type Dayjs } from "dayjs";
import "dayjs/locale/zh-cn";
import zhCN from "antd/locale/zh_CN";
export const historyDateLocale = zhCN;
export function historyDateRange(view: {
  startDate: string;
  endDate: string;
}): [Dayjs | null, Dayjs | null] {
  return [
    view.startDate ? dayjs(view.startDate).locale("zh-cn") : null,
    view.endDate ? dayjs(view.endDate).locale("zh-cn") : null,
  ];
}
export function historyDatesFromRange(range: readonly (Dayjs | null | undefined)[] | null) {
  return {
    startDate: range?.[0]?.format("YYYY-MM-DD") ?? "",
    endDate: range?.[1]?.format("YYYY-MM-DD") ?? "",
  };
}
