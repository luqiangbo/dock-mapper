import type { CSSProperties } from "react";
import type { ScreenshotConfig } from "../../../types";
import { STROKE_COLORS, type AnnotTool } from "./AnnotationToolbar";
import type { ArrowStyle, NumberStyle, TextStyle, ToolSettings } from "./annotationTypes";

interface ToolOptionsBarProps {
  tool: Exclude<AnnotTool, null>;
  settings: ToolSettings;
  onChange: (changes: Partial<ToolSettings>) => void;
  style?: CSSProperties;
}

const WIDTHS = [2, 4, 6, 8];
const PICKER_FORMATS: Array<{ value: ScreenshotConfig["color_copy_format"]; label: string }> = [
  { value: "hex", label: "HEX" },
  { value: "rgb", label: "RGB" },
  { value: "hsl", label: "HSL" },
  { value: "hsv", label: "HSV" },
  { value: "css", label: "CSS" },
];

function Swatches({ color, onChange }: { color: string; onChange: (color: string) => void }) {
  return (
    <span className="tool-options__colors" aria-label="颜色">
      {STROKE_COLORS.map((item) => (
        <button
          key={item}
          type="button"
          className={`tool-options__swatch${item === color ? " is-active" : ""}`}
          style={{ backgroundColor: item }}
          aria-label={item}
          onClick={() => onChange(item)}
        />
      ))}
      <input
        type="color"
        value={color}
        aria-label="自定义颜色"
        onChange={(event) => onChange(event.target.value)}
      />
    </span>
  );
}

function Segmented<T extends string | number>({
  value,
  values,
  onChange,
  label,
}: {
  value: T;
  values: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <span className="tool-options__segment" aria-label={label}>
      {values.map((item) => (
        <button
          key={String(item.value)}
          type="button"
          className={item.value === value ? "is-active" : ""}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </span>
  );
}

function ArrowPreview({ style }: { style: ArrowStyle }) {
  if (style === "filled")
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      >
        <path d="M3 12h13" />
        <path d="M21 12l-7-5v10z" fill="currentColor" stroke="none" />
      </svg>
    );
  if (style === "line")
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      >
        <path d="M3 12h18" />
      </svg>
    );
  if (style === "double")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="none">
        <path d="M3 12l6-5v10zM21 12l-6-5v10zM7 10.8h10v2.4H7z" />
      </svg>
    );
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12h17M20 12l-6-5M20 12l-6 5" />
    </svg>
  );
}

function ArrowChoices({
  value,
  onChange,
}: {
  value: ArrowStyle;
  onChange: (style: ArrowStyle) => void;
}) {
  const values: ArrowStyle[] = ["filled", "outline", "line", "double"];
  return (
    <span className="tool-options__arrow-choices" aria-label="箭头样式">
      {values.map((item) => (
        <button
          key={item}
          type="button"
          className={value === item ? "is-active" : ""}
          aria-label={item}
          onClick={() => onChange(item)}
        >
          <ArrowPreview style={item} />
        </button>
      ))}
    </span>
  );
}

function TextOptions({
  value,
  onChange,
}: {
  value: TextStyle;
  onChange: (changes: Partial<TextStyle>) => void;
}) {
  return (
    <>
      <label>
        字体
        <select
          value={value.font}
          onChange={(event) => onChange({ font: event.target.value as TextStyle["font"] })}
        >
          <option value="sans">无衬线</option>
          <option value="serif">衬线</option>
          <option value="mono">等宽</option>
        </select>
      </label>
      <label>
        字号
        <select
          value={value.fontSize}
          onChange={(event) =>
            onChange({ fontSize: Number(event.target.value) as TextStyle["fontSize"] })
          }
        >
          {[14, 16, 20, 24, 32, 40, 48].map((size) => (
            <option key={size} value={size}>
              {size}px
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={value.bold ? "is-active" : ""}
        onClick={() => onChange({ bold: !value.bold })}
      >
        粗体
      </button>
      <label>
        文字
        <input
          type="color"
          value={value.color}
          onChange={(event) => onChange({ color: event.target.value })}
        />
      </label>
      <label>
        描边
        <input
          type="color"
          value={value.strokeColor}
          onChange={(event) => onChange({ strokeColor: event.target.value })}
        />
      </label>
      <label>
        宽
        <select
          value={value.strokeWidth}
          onChange={(event) => onChange({ strokeWidth: Number(event.target.value) })}
        >
          {[0, 1, 2, 3, 4].map((size) => (
            <option key={size} value={size}>
              {size}px
            </option>
          ))}
        </select>
      </label>
      <label>
        背景
        <input
          type="color"
          value={value.backgroundColor}
          onChange={(event) => onChange({ backgroundColor: event.target.value })}
        />
      </label>
      <label>
        透明
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(value.backgroundOpacity * 100)}
          onChange={(event) => onChange({ backgroundOpacity: Number(event.target.value) / 100 })}
        />
      </label>
    </>
  );
}

function ToolOptionsBar({
  tool,
  settings,
  onChange,
  style,
}: ToolOptionsBarProps): React.JSX.Element {
  const color = (
    <Swatches color={settings.strokeColor} onChange={(strokeColor) => onChange({ strokeColor })} />
  );
  const widths = (
    <Segmented
      label="线宽"
      value={settings.strokeWidth}
      values={WIDTHS.map((value) => ({ value, label: `${value}` }))}
      onChange={(strokeWidth) => onChange({ strokeWidth })}
    />
  );
  return (
    <div className="tool-options" style={style} onMouseDown={(event) => event.stopPropagation()}>
      {tool === "rect" || tool === "ellipse" ? (
        <>
          {color}
          {widths}
          <Segmented
            label="填充透明度"
            value={settings.fillOpacity}
            values={[
              { value: 0, label: "无填充" },
              { value: 0.2, label: "20%" },
              { value: 0.4, label: "40%" },
            ]}
            onChange={(fillOpacity) => onChange({ fillOpacity })}
          />
        </>
      ) : null}
      {tool === "arrow" ? (
        <>
          {color}
          {widths}
          <ArrowChoices
            value={settings.arrowStyle}
            onChange={(arrowStyle) => onChange({ arrowStyle })}
          />
          <Segmented
            label="箭头大小"
            value={settings.arrowHeadSize}
            values={[
              { value: 0.8, label: "小" },
              { value: 1, label: "中" },
              { value: 1.25, label: "大" },
            ]}
            onChange={(arrowHeadSize) => onChange({ arrowHeadSize })}
          />
        </>
      ) : null}
      {tool === "pen" ? (
        <>
          {color}
          <Segmented
            label="画笔宽度"
            value={settings.penWidth}
            values={WIDTHS.map((value) => ({ value, label: `${value}` }))}
            onChange={(penWidth) => onChange({ penWidth })}
          />
          <span className="tool-options__hint">圆头笔触</span>
        </>
      ) : null}
      {tool === "highlight" ? (
        <>
          {color}
          <Segmented
            label="高亮宽度"
            value={settings.highlightWidth}
            values={[12, 20, 28, 36].map((value) => ({ value, label: `${value}` }))}
            onChange={(highlightWidth) => onChange({ highlightWidth })}
          />
          <Segmented
            label="高亮透明度"
            value={settings.highlightOpacity}
            values={[
              { value: 0.2, label: "20%" },
              { value: 0.32, label: "32%" },
              { value: 0.5, label: "50%" },
            ]}
            onChange={(highlightOpacity) => onChange({ highlightOpacity })}
          />
        </>
      ) : null}
      {tool === "mosaic" ? (
        <Segmented
          label="像素块大小"
          value={settings.mosaicBlock}
          values={[8, 12, 20, 32].map((value) => ({ value, label: `${value}px` }))}
          onChange={(mosaicBlock) => onChange({ mosaicBlock })}
        />
      ) : null}
      {tool === "text" ? (
        <TextOptions
          value={settings.textStyle}
          onChange={(changes) => onChange({ textStyle: { ...settings.textStyle, ...changes } })}
        />
      ) : null}
      {tool === "picker" ? (
        <Segmented
          label="复制格式"
          value={settings.pickerFormat}
          values={PICKER_FORMATS}
          onChange={(pickerFormat) => onChange({ pickerFormat })}
        />
      ) : null}
      {tool === "number" ? (
        <>
          <label>
            底色
            <input
              type="color"
              value={settings.numberStyle.backgroundColor}
              onChange={(event) =>
                onChange({
                  numberStyle: { ...settings.numberStyle, backgroundColor: event.target.value },
                })
              }
            />
          </label>
          <label>
            文字
            <input
              type="color"
              value={settings.numberStyle.textColor}
              onChange={(event) =>
                onChange({
                  numberStyle: { ...settings.numberStyle, textColor: event.target.value },
                })
              }
            />
          </label>
          <Segmented
            label="编号尺寸"
            value={settings.numberStyle.size}
            values={[24, 32, 40].map((value) => ({ value, label: `${value}px` }))}
            onChange={(size) => onChange({ numberStyle: { ...settings.numberStyle, size } })}
          />
        </>
      ) : null}
    </div>
  );
}

export default ToolOptionsBar;
