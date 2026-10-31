import { ColorPicker, Select, Space } from "antd";
import type { NumberStyle } from "./annotationTypes";
export function NumberToolOptions({
  style,
  change,
  popup,
}: {
  style: NumberStyle;
  change: (style: NumberStyle) => void;
  popup: (key: string, open: boolean) => void;
}) {
  const sizes = [...new Set([20, 24, 28, 32, 40, 48, 64, style.size])].sort((a, b) => a - b);
  return (
    <Space size={10} align="center" className="number-tool-options">
      <label>
        <span className="tool-options__label">颜色</span>
        <ColorPicker
          size="small"
          value={style.backgroundColor}
          disabledAlpha
          presets={[
            {
              label: "常用颜色",
              colors: ["#e03131", "#f08c00", "#2f9e44", "#1971c2", "#7048e8", "#1e1e1e"],
            },
          ]}
          onOpenChange={(open) => popup("number-color", open)}
          onChangeComplete={(color) =>
            change({
              ...style,
              appearance: "flat",
              palette: "custom",
              backgroundColor: color.toHexString(),
              textColor: "#ffffff",
            })
          }
        />
      </label>
      <label>
        <span className="tool-options__label">大小</span>
        <Select
          size="small"
          aria-label="序号大小"
          value={style.size}
          style={{ width: 78 }}
          options={sizes.map((value) => ({ value, label: value + " px" }))}
          onOpenChange={(open) => popup("number-size", open)}
          onChange={(size) => change({ ...style, size })}
        />
      </label>
    </Space>
  );
}
