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
  onPreviewChange?: (changes: Partial<ToolSettings>) => void;
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
const WIDTHS = [
  { value: 1, label: "1 px" },
  { value: 2, label: "2 px" },
  { value: 3, label: "3 px" },
  { value: 4, label: "4 px" },
  { value: 6, label: "6 px" },
  { value: 8, label: "8 px" },
  { value: 12, label: "12 px" },
];
const OPACITIES = [25, 50, 75, 100].map((value) => ({ value, label: `${value}%` }));
const ROUNDNESS_OPTIONS = [
  { value: "sharp", label: "尖角" },
  { value: "round", label: "圆角" },
];
const TEXT_ALIGN_OPTIONS = [
  { value: "left", label: "左对齐" },
  { value: "center", label: "居中" },
  { value: "right", label: "右对齐" },
];
const FONT_OPTIONS: Array<{ value: TextStyle["font"]; label: string }> = [
  { value: "virgil", label: "Virgil" },
  { value: "helvetica", label: "Helvetica" },
  { value: "cascadia", label: "Cascadia" },
  { value: "excalifont", label: "Excalifont" },
  { value: "nunito", label: "Nunito" },
  { value: "lilita", label: "Lilita One" },
  { value: "comic-shanns", label: "Comic Shanns" },
  { value: "liberation-sans", label: "Liberation Sans" },
];
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
  mixed = false,
}: {
  label: string;
  value: string | number;
  options: Array<{ value: string | number; label: ReactNode }>;
  name: string;
  change: (value: string | number) => void;
  popup: (key: string, open: boolean) => void;
  compactWidth?: number;
  mixed?: boolean;
}) {
  return (
    <Group label={label}>
      <Select
        size="small"
        aria-label={label}
        value={mixed ? undefined : value}
        placeholder={mixed ? "混合" : undefined}
        options={options}
        style={{ width: compactWidth ?? 68 }}
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
    onPreviewChange,
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
  const isMixed = (property: string) => settings.mixedProperties?.includes(property) ?? false;
  const previewChange = onPreviewChange ?? onChange;
  const fillColorChanges = (fillColor: string): Partial<ToolSettings> => ({
    fillColor,
    ...(settings.fillStyle === "none" && !isMixed("fillStyle")
      ? { fillStyle: "solid" as const }
      : {}),
  });
  const color = (
    <Color
      label="颜色"
      value={settings.strokeColor}
      name={`${tool}-color`}
      change={(strokeColor) => previewChange({ strokeColor })}
      commit={(strokeColor) => {
        onChange({ strokeColor });
        onColorCommit?.(strokeColor);
      }}
      popup={popup}
      palette={palette}
      quickColors={PRESETS[0].colors}
      compact
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
      compactWidth={62}
      mixed={isMixed("strokeWidth")}
    />
  );
  const opacity = (
    <Choice
      label="透明度"
      value={settings.opacity}
      options={OPACITIES}
      name={`${tool}-opacity`}
      change={(value) => onChange({ opacity: selectNumber(value) })}
      popup={popup}
      mixed={isMixed("opacity")}
    />
  );
  const selectedKinds = [...new Set(selectedTools.filter((value): value is Exclude<AnnotTool, null> => value !== null))];
  const capabilities = excalidrawStyleCapabilities(selectedKinds);
  const mixedKinds = selectedKinds.length > 1;
  const sharedOptions = mixedKinds ? (
    <>
      {color}
      {capabilities.strokeWidth && width}
      {capabilities.fill && (
        <>
          <Color
            label="填充"
            value={settings.fillColor}
            name="shared-fill-color"
            change={(fillColor) => previewChange(fillColorChanges(fillColor))}
            commit={(fillColor) => onChange(fillColorChanges(fillColor))}
            popup={popup}
            palette={palette}
            compact
          />
          <Choice
            label="填充"
            value={settings.fillStyle}
            options={[...FILL_STYLE_OPTIONS]}
            name="shared-fill-style"
            change={(value) => onChange({ fillStyle: value as FillStyle })}
            popup={popup}
            mixed={isMixed("fillStyle")}
          />
        </>
      )}
      {capabilities.lineStyle && capabilities.roughness && (
        <>
          <Choice
            label="样式"
            value={settings.lineStyle}
            options={[...LINE_STYLE_OPTIONS]}
            name="shared-line-style"
            compactWidth={76}
            change={(value) => onChange({ lineStyle: value as LineStyle })}
            popup={popup}
            mixed={isMixed("lineStyle")}
          />
          <Choice
            label="粗糙度"
            value={settings.roughness}
            options={[...ROUGHNESS_OPTIONS]}
            name="shared-roughness"
            change={(value) => onChange({ roughness: value as Roughness })}
            popup={popup}
            mixed={isMixed("roughness")}
          />
        </>
      )}
      {capabilities.opacity && opacity}
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
            compactWidth={76}
            change={(value) => onChange({ lineStyle: value as LineStyle })}
            popup={popup}
            mixed={isMixed("lineStyle")}
          />
          <Color
            label="填充"
            value={settings.fillColor}
            name="frame-fill-color"
            change={(fillColor) => previewChange(fillColorChanges(fillColor))}
            commit={(fillColor) => onChange(fillColorChanges(fillColor))}
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
            mixed={isMixed("fillStyle")}
          />
          <Choice
            label="粗糙度"
            value={settings.roughness}
            options={[...ROUGHNESS_OPTIONS]}
            name="frame-roughness"
            change={(value) => onChange({ roughness: value as Roughness })}
            popup={popup}
            mixed={isMixed("roughness")}
          />
          {tool === "rect" && (
            <Choice
              label="边角"
              value={settings.roundness}
              options={ROUNDNESS_OPTIONS}
              name="rectangle-roundness"
              change={(value) => onChange({ roundness: value as ToolSettings["roundness"] })}
              popup={popup}
              mixed={isMixed("roundness")}
            />
          )}
          {opacity}
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
                compactWidth={82}
                change={(value) => onChange({ arrowStyle: value as ArrowStyle })}
                popup={popup}
                mixed={isMixed("arrowStyle")}
              />
              <Choice
                label="起点"
                value={settings.startArrowhead}
                options={[...ARROWHEAD_OPTIONS]}
                name="arrow-start"
                change={(value) => onChange({ startArrowhead: value as Arrowhead })}
                popup={popup}
                mixed={isMixed("startArrowhead")}
              />
              <Choice
                label="终点"
                value={settings.endArrowhead}
                options={[...ARROWHEAD_OPTIONS]}
                name="arrow-end"
                change={(value) => onChange({ endArrowhead: value as Arrowhead })}
                popup={popup}
                mixed={isMixed("endArrowhead")}
              />
            </>
          )}
          <Choice
            label="样式"
            value={settings.lineStyle}
            options={[...LINE_STYLE_OPTIONS]}
            name="arrow-line-style"
            compactWidth={76}
            change={(value) => onChange({ lineStyle: value as LineStyle })}
            popup={popup}
            mixed={isMixed("lineStyle")}
          />
          <Choice
            label="粗糙度"
            value={settings.roughness}
            options={[...ROUGHNESS_OPTIONS]}
            name={`${tool}-roughness`}
            change={(value) => onChange({ roughness: value as Roughness })}
            popup={popup}
            mixed={isMixed("roughness")}
          />
          {opacity}
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
            compactWidth={62}
            mixed={isMixed("strokeWidth")}
          />
          {opacity}
        </>
      )}
      {!sharedOptions && tool === "text" && (
        <>
          <Choice
            label="字体"
            value={settings.textStyle.font}
            options={FONT_OPTIONS}
            name="text-font"
            compactWidth={104}
            change={(value) =>
              onChange({ textStyle: { ...settings.textStyle, font: value as TextStyle["font"] } })
            }
            popup={popup}
            mixed={isMixed("fontFamily")}
          />
          <Choice
            label="字号"
            value={settings.textStyle.fontSize}
            options={[14, 16, 20, 24, 32, 40, 48].map((value) => ({ value, label: `${value}px` }))}
            name="text-size"
            compactWidth={66}
            change={(value) =>
              onChange({
                textStyle: {
                  ...settings.textStyle,
                  fontSize: selectNumber(value) as TextStyle["fontSize"],
                },
              })
            }
            popup={popup}
            mixed={isMixed("fontSize")}
          />
          <Choice
            label="对齐"
            value={settings.textStyle.textAlign}
            options={TEXT_ALIGN_OPTIONS}
            name="text-align"
            compactWidth={70}
            change={(value) => onChange({
              textStyle: {
                ...settings.textStyle,
                textAlign: value as TextStyle["textAlign"],
              },
            })}
            popup={popup}
            mixed={isMixed("textAlign")}
          />
          {color}
          {opacity}
        </>
      )}
    </div>
  );
});
export default ToolOptionsBar;
