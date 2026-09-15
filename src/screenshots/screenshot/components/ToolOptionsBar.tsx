import { ColorPicker, Select } from "antd";
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import type {
  AnnotationOutlineConfig,
  ColorPaletteConfig,
  ScreenshotConfig,
} from "../../../types";
import { STROKE_COLORS, type AnnotTool } from "./AnnotationToolbar";
import { excalidrawStyleCapabilities } from "./excalidrawScreenshotAdapter";
import {
  FRAME_SHAPE_OPTIONS,
  ARROWHEAD_OPTIONS,
  FILL_STYLE_OPTIONS,
  LINE_STYLE_OPTIONS,
  ROUGHNESS_OPTIONS,
  normalizeArrowStyle,
  type ArrowStyle,
  type Arrowhead,
  type FillStyle,
  type FrameShape,
  type LineStyle,
  type Roughness,
  type TextStyle,
  type ToolSettings,
} from "./annotationTypes";
import { ARROW_SHAPE_CHOICES } from "./ArrowOptionThumbs";
import { normalizeHexColor, selectNumber } from "./toolOptionValues";

interface Props {
  tool: Exclude<AnnotTool, null>;
  settings: ToolSettings;
  onChange: (changes: Partial<ToolSettings>) => void;
  onColorCommit?: (color: string) => void;
  onOutlineCommit?: (outline: AnnotationOutlineConfig) => void;
  onPopupOpenChange: (open: boolean) => void;
  palette?: ColorPaletteConfig;
  paletteBusy?: boolean;
  onPaletteCopy?: (color: string) => void;
  onPaletteFavorite?: (color: string, favorite: boolean) => void;
  selectedTools?: AnnotTool[];
  style?: CSSProperties;
}

function Outline({
  value,
  change,
  commit,
  popup,
}: {
  value: AnnotationOutlineConfig;
  change: (value: AnnotationOutlineConfig) => void;
  commit?: (value: AnnotationOutlineConfig) => void;
  popup: (key: string, open: boolean) => void;
}) {
  const applyColor = (color: string): AnnotationOutlineConfig => ({
    ...value,
    enabled: true,
    color,
  });
  return (
    <span className="tool-options__group tool-options__group--color-only">
      <ColorPicker
        mode="single"
        value={value.color}
        allowClear
        disabledAlpha
        disabledFormat
        presets={[{ label: "描边", colors: ["#ffffff", "#000000", ...STROKE_COLORS] }]}
        placement="bottom"
        onOpenChange={(open) => popup("annotation-outline", open)}
        onChange={(color) => change(applyColor(normalizeHexColor(color.toHexString())))}
        onChangeComplete={(color) =>
          commit?.(applyColor(normalizeHexColor(color.toHexString())))
        }
        onClear={() => {
          const next = { ...value, enabled: false };
          change(next);
          commit?.(next);
        }}
      >
        <button
          type="button"
          className={`tool-options__outline-trigger${value.enabled ? "" : " is-disabled"}`}
          aria-label={value.enabled ? `描边：${value.color}` : "描边：无"}
          title={value.enabled ? `描边 ${value.color}` : "无描边"}
        >
          <span style={{ borderColor: value.color }} />
        </button>
      </ColorPicker>
    </span>
  );
}
const WIDTHS = [2, 3, 4, 6, 8].map((value) => ({ value, label: `${value}px` }));
const PRESETS = [{ label: "快捷色", colors: [...STROKE_COLORS] }];
const FORMATS: Array<{ value: ScreenshotConfig["color_copy_format"]; label: string }> = [
  "hex",
  "rgb",
  "hsl",
  "hsv",
  "css",
].map((value) => ({
  value: value as ScreenshotConfig["color_copy_format"],
  label: value.toUpperCase(),
}));

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="tool-options__group">
      <span className="tool-options__label">{label}</span>
      {children}
    </span>
  );
}
function Color({
  label,
  value,
  name,
  change,
  commit,
  popup,
  palette,
  quickColors = STROKE_COLORS,
  presetLabel = "快捷色",
  compact = false,
}: {
  label: string;
  value: string;
  name: string;
  change: (value: string) => void;
  commit?: (value: string) => void;
  popup: (key: string, open: boolean) => void;
  palette?: ColorPaletteConfig;
  quickColors?: readonly string[];
  presetLabel?: string;
  compact?: boolean;
}) {
  const presets = [
    { label: presetLabel, colors: [...quickColors] },
    ...(palette?.favorites.length
      ? [{ label: "收藏", colors: palette.favorites.slice(0, 5) }]
      : []),
    ...(palette?.recent.length ? [{ label: "最近吸取", colors: palette.recent.slice(0, 5) }] : []),
  ];
  const picker = (
    <ColorPicker
      mode="single"
      value={value}
      disabledAlpha
      disabledFormat
      presets={presets}
      placement="bottom"
      onOpenChange={(open) => popup(name, open)}
      onChange={(color) => change(normalizeHexColor(color.toHexString()))}
      onChangeComplete={(color) => commit?.(normalizeHexColor(color.toHexString()))}
    >
      <button
        type="button"
        className="tool-options__color-trigger"
        aria-label={`${label}：${value}`}
        title={`${label} ${value}`}
      >
        <span className="tool-options__color-swatch" style={{ backgroundColor: value }} />
      </button>
    </ColorPicker>
  );
  return compact ? (
    <span className="tool-options__group tool-options__group--color-only">{picker}</span>
  ) : (
    <Group label={label}>{picker}</Group>
  );
}
function Choice({
  label,
  value,
  options,
  name,
  change,
  popup,
  compactWidth,
}: {
  label: string;
  value: string | number;
  options: Array<{ value: string | number; label: ReactNode }>;
  name: string;
  change: (value: string | number) => void;
  popup: (key: string, open: boolean) => void;
  compactWidth?: number;
}) {
  return (
    <Group label={label}>
      <Select
        size="small"
        aria-label={label}
        value={value}
        options={options}
        style={compactWidth ? { width: compactWidth } : undefined}
        popupMatchSelectWidth={false}
        onOpenChange={(open) => popup(name, open)}
        onChange={change}
      />
    </Group>
  );
}

function PaletteGroup({
  label,
  colors,
  favorites,
  busy,
  onCopy,
  onFavorite,
}: {
  label: string;
  colors: string[];
  favorites: string[];
  busy?: boolean;
  onCopy?: (color: string) => void;
  onFavorite?: (color: string, favorite: boolean) => void;
}): React.JSX.Element {
  return (
    <Group label={label}>
      <span className="palette-strip" aria-label={`${label}颜色`}>
        {colors.length === 0 ? (
          <span className="palette-strip__empty">—</span>
        ) : (
          colors.slice(0, 5).map((color) => {
            const saved = favorites.includes(color);
            return (
              <span className="palette-strip__item" key={color}>
                <button
                  type="button"
                  className="palette-strip__swatch"
                  style={{ backgroundColor: color }}
                  title={`复制 ${color}`}
                  aria-label={`复制 ${color}`}
                  disabled={busy}
                  onClick={() => onCopy?.(color)}
                />
                <button
                  type="button"
                  className={`palette-strip__star${saved ? " is-saved" : ""}`}
                  title={saved ? "取消收藏" : "收藏颜色"}
                  aria-label={saved ? `取消收藏 ${color}` : `收藏 ${color}`}
                  disabled={busy}
                  onClick={() => onFavorite?.(color, !saved)}
                >
                  {saved ? "★" : "☆"}
                </button>
              </span>
            );
          })
        )}
      </span>
    </Group>
  );
}

const ToolOptionsBar = forwardRef<HTMLDivElement, Props>(function ToolOptionsBar(
  {
    tool,
    settings,
    onChange,
    onColorCommit,
    onOutlineCommit,
    onPopupOpenChange,
    palette = { recent: [], favorites: [] },
    paletteBusy,
    onPaletteCopy,
    onPaletteFavorite,
    selectedTools = [],
    style,
  },
  ref,
) {
  const opened = useRef(new Set<string>());
  useEffect(() => () => onPopupOpenChange(false), [onPopupOpenChange]);
  const popup = useCallback(
    (key: string, open: boolean) => {
      if (open) opened.current.add(key);
      else opened.current.delete(key);
      onPopupOpenChange(opened.current.size > 0);
    },
    [onPopupOpenChange],
  );
  const color = (
    <Color
      label="颜色"
      value={settings.strokeColor}
      name={`${tool}-color`}
      change={(strokeColor) => onChange({ strokeColor })}
      commit={onColorCommit}
      popup={popup}
      palette={palette}
      quickColors={PRESETS[0].colors}
      compact
    />
  );
  const outline = (
    <Outline
      value={settings.outline}
      change={(next) => onChange({ outline: next })}
      commit={onOutlineCommit}
      popup={popup}
    />
  );
  const width = (
    <Choice
      label="线宽"
      value={settings.strokeWidth}
      options={WIDTHS}
      name={`${tool}-width`}
      change={(value) => onChange({ strokeWidth: selectNumber(value) })}
      popup={popup}
    />
  );
  const selectedKinds = [...new Set(selectedTools.filter((value): value is Exclude<AnnotTool, null> => value !== null))];
  const capabilities = excalidrawStyleCapabilities(selectedKinds);
  const mixedKinds = selectedKinds.length > 1 && !capabilities.fill;
  const sharedOptions = mixedKinds ? (
    <>
      {color}
      {capabilities.strokeWidth && width}
      {capabilities.lineStyle && capabilities.roughness && (
        <>
          <Choice
            label="样式"
            value={settings.lineStyle}
            options={[...LINE_STYLE_OPTIONS]}
            name="shared-line-style"
            compactWidth={108}
            change={(value) => onChange({ lineStyle: value as LineStyle })}
            popup={popup}
          />
          <Choice
            label="粗糙度"
            value={settings.roughness}
            options={[...ROUGHNESS_OPTIONS]}
            name="shared-roughness"
            change={(value) => onChange({ roughness: value as Roughness })}
            popup={popup}
          />
        </>
      )}
    </>
  ) : null;
  return (
    <div
      ref={ref}
      className={`tool-options${tool === "picker" ? " tool-options--picker" : ""}`}
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {settings.mixedProperties?.length ? (
        <span className="tool-options__mixed" title={`混合属性：${settings.mixedProperties.join("、")}`}>混合</span>
      ) : null}
      {sharedOptions ? sharedOptions : (tool === "rect" || tool === "ellipse" || tool === "diamond") && (
        <>
          {color}
          {width}
          <Choice
            label="样式"
            value={settings.lineStyle}
            options={[...LINE_STYLE_OPTIONS]}
            name="frame-line-style"
            compactWidth={108}
            change={(value) => onChange({ lineStyle: value as LineStyle })}
            popup={popup}
          />
          <Color
            label="填充"
            value={settings.fillColor}
            name="frame-fill-color"
            change={(fillColor) => onChange({ fillColor })}
            popup={popup}
            palette={palette}
            compact
          />
          <Choice
            label="填充"
            value={settings.fillStyle}
            options={[...FILL_STYLE_OPTIONS]}
            name="frame-fill-style"
            change={(value) => onChange({ fillStyle: value as FillStyle })}
            popup={popup}
          />
          <Choice
            label="粗糙度"
            value={settings.roughness}
            options={[...ROUGHNESS_OPTIONS]}
            name="frame-roughness"
            change={(value) => onChange({ roughness: value as Roughness })}
            popup={popup}
          />
        </>
      )}
      {!sharedOptions && (tool === "arrow" || tool === "line") && (
        <>
          {color}
          {width}
          {tool === "arrow" && (
            <>
              <Choice
                label="形状"
                value={normalizeArrowStyle(settings.arrowStyle)}
                options={ARROW_SHAPE_CHOICES}
                name="arrow-style"
                compactWidth={116}
                change={(value) => onChange({ arrowStyle: value as ArrowStyle })}
                popup={popup}
              />
              <Choice
                label="起点"
                value={settings.startArrowhead}
                options={[...ARROWHEAD_OPTIONS]}
                name="arrow-start"
                change={(value) => onChange({ startArrowhead: value as Arrowhead })}
                popup={popup}
              />
              <Choice
                label="终点"
                value={settings.endArrowhead}
                options={[...ARROWHEAD_OPTIONS]}
                name="arrow-end"
                change={(value) => onChange({ endArrowhead: value as Arrowhead })}
                popup={popup}
              />
            </>
          )}
          <Choice
            label="样式"
            value={settings.lineStyle}
            options={[...LINE_STYLE_OPTIONS]}
            name="arrow-line-style"
            compactWidth={108}
            change={(value) => onChange({ lineStyle: value as LineStyle })}
            popup={popup}
          />
          <Choice
            label="粗糙度"
            value={settings.roughness}
            options={[...ROUGHNESS_OPTIONS]}
            name={`${tool}-roughness`}
            change={(value) => onChange({ roughness: value as Roughness })}
            popup={popup}
          />
        </>
      )}
      {!sharedOptions && tool === "pen" && (
        <>
          {color}
          <Choice
            label="宽度"
            value={settings.penWidth}
            options={WIDTHS}
            name="pen-width"
            change={(value) => onChange({ penWidth: selectNumber(value) })}
            popup={popup}
          />
        </>
      )}
      {!sharedOptions && tool === "text" && (
        <>
          <Choice
            label="字体"
            value={settings.textStyle.font}
            options={[
              { value: "sans", label: "无衬线" },
              { value: "serif", label: "衬线" },
              { value: "mono", label: "等宽" },
            ]}
            name="text-font"
            change={(value) =>
              onChange({ textStyle: { ...settings.textStyle, font: value as TextStyle["font"] } })
            }
            popup={popup}
          />
          <Choice
            label="字号"
            value={settings.textStyle.fontSize}
            options={[14, 16, 20, 24, 32, 40, 48].map((value) => ({ value, label: `${value}px` }))}
            name="text-size"
            change={(value) =>
              onChange({
                textStyle: {
                  ...settings.textStyle,
                  fontSize: selectNumber(value) as TextStyle["fontSize"],
                },
              })
            }
            popup={popup}
          />
          <Color
            label="文字"
            value={settings.textStyle.color}
            name="text-color"
            change={(color) => onChange({ textStyle: { ...settings.textStyle, color } })}
            popup={popup}
            palette={palette}
          />
        </>
      )}
    </div>
  );
});
export default ToolOptionsBar;
