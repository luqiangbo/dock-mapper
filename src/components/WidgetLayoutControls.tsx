import { Button, InputNumber, Select, Typography } from "antd";
import type { WidgetLayoutSettings } from "../types";
import { DEFAULT_WIDGET_LAYOUT } from "../widgetPresentation";
import styles from "./components.module.scss";

const fields = [
  { key: "metric_gap", label: "指标间距", min: 0, max: 20 },
  { key: "horizontal_padding", label: "左右内边距", min: 0, max: 16 },
  { key: "task_list_gap", label: "距任务栏图标", min: 0, max: 40 },
  { key: "tray_gap", label: "距托盘", min: 0, max: 40 },
  { key: "vertical_offset", label: "垂直偏移", min: -12, max: 12 },
  { key: "font_size", label: "资源文字大小", min: 12, max: 18 },
  { key: "icon_size", label: "资源图标大小", min: 14, max: 22 },
] as const;

export function WidgetLayoutControls({
  value,
  onChange,
}: {
  value: WidgetLayoutSettings;
  onChange: (next: WidgetLayoutSettings) => void;
}) {
  return (
    <div className={styles.widgetLayoutControls}>
      <div className={styles.widgetLayoutHeading}>
        <Typography.Text strong>布局、尺寸与距离</Typography.Text>
        <Button size="small" onClick={() => onChange({ ...DEFAULT_WIDGET_LAYOUT })}>
          恢复默认布局
        </Button>
      </div>
      <label className={styles.widgetLayoutField}>
        <span>布局模式</span>
        <Select
          aria-label="挂件布局模式"
          value={value.mode}
          options={[
            { value: "auto", label: "自动适配" },
            { value: "standard", label: "标准" },
            { value: "compact", label: "紧凑" },
          ]}
          onChange={(mode) => onChange({ ...value, mode })}
        />
      </label>
      <p className={styles.description}>
        {value.mode === "auto"
          ? "空间不足时先减半内部间距，再收起末尾整列；上下组合的指标一起显示或收起。"
          : "保持所选字号和自定义间距，空间不足时收起末尾整列。"}
      </p>
      <div className={styles.widgetDistanceGrid}>
        {fields.map(({ key, label, min, max }) => (
          <label className={styles.widgetLayoutField} key={key}>
            <span>{label}</span>
            <InputNumber
              aria-label={label}
              value={value[key]}
              min={min}
              max={max}
              precision={0}
              suffix="px"
              onChange={(next) => {
                if (next !== null)
                  onChange({ ...value, [key]: Math.max(min, Math.min(max, Math.round(next))) });
              }}
            />
          </label>
        ))}
      </div>
      <p className={styles.description}>
        距离随显示缩放调整；双行时标记适当缩小，保证上下内容完整显示。外部距离和垂直偏移始终限制在安全区域内。
      </p>
    </div>
  );
}
