import { ColorPicker, Select } from "antd";
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { ColorPaletteConfig, ScreenshotConfig } from "../../../types";
import { STROKE_COLORS, type AnnotTool } from "./AnnotationToolbar";
import {
  DEFAULT_FRAME_EFFECT,
  FRAME_EFFECT_OPTIONS,
  FRAME_SHAPE_OPTIONS,
  normalizeArrowStyle,
  type ArrowStyle,
  type FrameEffect,
  type FrameShape,
  type GradientStop,
  type TextStyle,
  type ToolSettings,
} from "./annotationTypes";
import { ARROW_SHAPE_CHOICES } from "./ArrowOptionThumbs";
import ArrowBrushPicker from "./ArrowBrushPicker";
import { normalizeHexColor, selectNumber } from "./toolOptionValues";
import { normalizeGradientStops } from "./annotationPaint";

interface Props {
  tool: Exclude<AnnotTool, null>;
  settings: ToolSettings;
  onChange: (changes: Partial<ToolSettings>) => void;
  onPopupOpenChange: (open: boolean) => void;
  palette?: ColorPaletteConfig;
  paletteBusy?: boolean;
  onPaletteCopy?: (color: string) => void;
  onPaletteFavorite?: (color: string, favorite: boolean) => void;
  style?: CSSProperties;
}
const WIDTHS = [2, 3, 4, 6, 8].map((value) => ({ value, label: `${value}px` }));
const PRESETS = [{ label: "快捷色", colors: [...STROKE_COLORS] }];
const ARROW_CRAYON_COLORS = [
  "#ff2d2d",
  "#ffad42",
  "#6c63ff",
  "#a90cc2",
  "#178f28",
  "#39bf20",
] as const;
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
  popup,
  palette,
  quickColors = STROKE_COLORS,
  presetLabel = "快捷色",
  gradientStops,
  allowGradient = false,
}: {
  label: string;
  value: string;
  name: string;
  change: (value: string, gradientStops?: GradientStop[] | null) => void;
  popup: (key: string, open: boolean) => void;
  palette?: ColorPaletteConfig;
  quickColors?: readonly string[];
  presetLabel?: string;
  gradientStops?: GradientStop[] | null;
  allowGradient?: boolean;
}) {
  const presets = [
    { label: presetLabel, colors: [...quickColors] },
    ...(palette?.favorites.length
      ? [{ label: "收藏", colors: palette.favorites.slice(0, 5) }]
      : []),
    ...(palette?.recent.length ? [{ label: "最近吸取", colors: palette.recent.slice(0, 5) }] : []),
  ];
  return (
    <Group label={label}>
      <ColorPicker
        size="small"
        mode={allowGradient ? ["single", "gradient"] : "single"}
        value={
          allowGradient && gradientStops?.length
            ? gradientStops.map((stop) => ({ color: stop.color, percent: stop.offset * 100 }))
            : value
        }
        disabledAlpha
        disabledFormat
        presets={presets}
        placement="bottom"
        onOpenChange={(open) => popup(name, open)}
        onChange={(color) => {
          if (allowGradient && color.isGradient()) {
            const stops = normalizeGradientStops(
              color.getColors().map((stop) => ({
                offset: Math.max(0, Math.min(1, stop.percent / 100)),
                color: normalizeHexColor(stop.color.toHexString()),
              })),
            );
            change(stops?.[0]?.color ?? value, stops ?? null);
          } else change(normalizeHexColor(color.toHexString()), null);
        }}
      />
    </Group>
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
    onPopupOpenChange,
    palette = { recent: [], favorites: [] },
    paletteBusy,
    onPaletteCopy,
    onPaletteFavorite,
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
  const arrowBrushPopup = useCallback(
    (open: boolean) => popup("arrow-brush", open),
    [popup],
  );
  const color = (
    <Color
      label="颜色"
      value={settings.strokeColor}
      name={`${tool}-color`}
      change={(strokeColor, gradientStops) =>
        onChange(
          tool === "arrow" || tool === "rect" || tool === "ellipse"
            ? { strokeColor, gradientStops }
            : { strokeColor },
        )
      }
      popup={popup}
      palette={palette}
      quickColors={tool === "arrow" ? ARROW_CRAYON_COLORS : PRESETS[0].colors}
      presetLabel={tool === "arrow" ? "推荐色" : "快捷色"}
      gradientStops={settings.gradientStops}
      allowGradient={tool === "arrow" || tool === "rect" || tool === "ellipse"}
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
  const fillOptions = [
    { value: 0, label: "无" },
    ...[20, 40, 60, 80].map((n) => ({ value: n / 100, label: `${n}%` })),
  ];
  return (
    <div
      ref={ref}
      className={`tool-options${tool === "picker" ? " tool-options--picker" : ""}`}
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {(tool === "rect" || tool === "ellipse") && (
        <>
          <Choice
            label="形状"
            value={settings.shapeKind}
            options={[...FRAME_SHAPE_OPTIONS]}
            name="frame-shape"
            compactWidth={72}
            change={(value) => onChange({ shapeKind: value as FrameShape })}
            popup={popup}
          />
          {color}
          {width}
          <Choice
            label="效果"
            value={settings.shapeEffect ?? DEFAULT_FRAME_EFFECT}
            options={[...FRAME_EFFECT_OPTIONS]}
            name="frame-effect"
            compactWidth={96}
            change={(value) => onChange({ shapeEffect: value as FrameEffect })}
            popup={popup}
          />
          <Choice
            label="填充"
            value={settings.fillOpacity}
            options={fillOptions}
            name="fill"
            change={(value) => onChange({ fillOpacity: selectNumber(value) })}
            popup={popup}
          />
        </>
      )}
      {tool === "arrow" && (
        <>
          {color}
          <Choice
            label="形状"
            value={normalizeArrowStyle(settings.arrowStyle)}
            options={ARROW_SHAPE_CHOICES}
            name="arrow-style"
            compactWidth={116}
            change={(value) => onChange({ arrowStyle: value as ArrowStyle })}
            popup={popup}
          />
          <Group label="笔刷">
            <ArrowBrushPicker
              value={settings.arrowBrushId}
              onChange={(arrowBrushId) => onChange({ arrowBrushId })}
              onOpenChange={arrowBrushPopup}
            />
          </Group>
        </>
      )}
      {tool === "pen" && (
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
      {tool === "highlight" && (
        <>
          {color}
          <Choice
            label="宽度"
            value={settings.highlightWidth}
            options={[12, 20, 28, 36].map((value) => ({ value, label: `${value}px` }))}
            name="highlight-width"
            change={(value) => onChange({ highlightWidth: selectNumber(value) })}
            popup={popup}
          />
          <Choice
            label="透明度"
            value={settings.highlightOpacity}
            options={[20, 32, 50, 70].map((n) => ({ value: n / 100, label: `${n}%` }))}
            name="highlight-opacity"
            change={(value) => onChange({ highlightOpacity: selectNumber(value) })}
            popup={popup}
          />
        </>
      )}
      {tool === "mosaic" && (
        <Choice
          label="像素块"
          value={settings.mosaicBlock}
          options={[8, 12, 20, 32].map((value) => ({ value, label: `${value}px` }))}
          name="mosaic-size"
          change={(value) => onChange({ mosaicBlock: selectNumber(value) })}
          popup={popup}
        />
      )}
      {(tool === "text" || (tool === "arrow" && settings.arrowStyle === "label")) && (
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
          <Choice
            label="字重"
            value={settings.textStyle.bold ? "bold" : "normal"}
            options={[
              { value: "normal", label: "常规" },
              { value: "bold", label: "粗体" },
            ]}
            name="text-weight"
            change={(value) =>
              onChange({ textStyle: { ...settings.textStyle, bold: value === "bold" } })
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
          <Choice
            label="描边"
            value={settings.textStyle.strokeWidth}
            options={[0, 1, 2, 3, 4].map((value) => ({
              value,
              label: value ? `${value}px` : "无",
            }))}
            name="text-stroke"
            change={(value) =>
              onChange({ textStyle: { ...settings.textStyle, strokeWidth: selectNumber(value) } })
            }
            popup={popup}
          />
          {settings.textStyle.strokeWidth > 0 && (
            <Color
              label="描边色"
              value={settings.textStyle.strokeColor}
              name="text-stroke-color"
              change={(strokeColor) =>
                onChange({ textStyle: { ...settings.textStyle, strokeColor } })
              }
              popup={popup}
              palette={palette}
            />
          )}
        </>
      )}
      {tool === "picker" && (
        <>
          <Choice
            label="复制格式"
            value={settings.pickerFormat}
            options={FORMATS}
            name="picker-format"
            change={(value) =>
              onChange({ pickerFormat: value as ScreenshotConfig["color_copy_format"] })
            }
            popup={popup}
          />
          <PaletteGroup
            label="收藏"
            colors={palette.favorites}
            favorites={palette.favorites}
            busy={paletteBusy}
            onCopy={onPaletteCopy}
            onFavorite={onPaletteFavorite}
          />
          <PaletteGroup
            label="最近"
            colors={palette.recent}
            favorites={palette.favorites}
            busy={paletteBusy}
            onCopy={onPaletteCopy}
            onFavorite={onPaletteFavorite}
          />
        </>
      )}
      {tool === "number" && (
        <>
          <Color
            label="底色"
            value={settings.numberStyle.backgroundColor}
            name="number-background"
            change={(backgroundColor) =>
              onChange({ numberStyle: { ...settings.numberStyle, backgroundColor } })
            }
            popup={popup}
            palette={palette}
          />
          <Color
            label="文字"
            value={settings.numberStyle.textColor}
            name="number-text"
            change={(textColor) =>
              onChange({ numberStyle: { ...settings.numberStyle, textColor } })
            }
            popup={popup}
            palette={palette}
          />
          <Choice
            label="尺寸"
            value={settings.numberStyle.size}
            options={[24, 32, 40].map((value) => ({ value, label: `${value}px` }))}
            name="number-size"
            change={(value) =>
              onChange({ numberStyle: { ...settings.numberStyle, size: selectNumber(value) } })
            }
            popup={popup}
          />
        </>
      )}
    </div>
  );
});
export default ToolOptionsBar;
