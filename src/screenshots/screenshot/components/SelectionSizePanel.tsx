import { InputNumber, Select } from "antd";
import { useEffect, useState, type KeyboardEvent } from "react";
import type {
  AspectRatio,
  CaptureSizeUnit,
  OutputSize,
  OutputSizeLimits,
  PanelPosition,
} from "./selectionSizeGeometry";

export const SELECTION_SIZE_PANEL_SIZE = { width: 370, height: 38 } as const;
export type AspectPreset = "free" | "current" | "1:1" | "4:3" | "16:9" | "9:16" | "custom";

interface SelectionSizePanelProps {
  size: OutputSize;
  limits: OutputSizeLimits;
  position: PanelPosition;
  unit: CaptureSizeUnit;
  aspectPreset: AspectPreset;
  aspectRatio: AspectRatio | null;
  showInputs: boolean;
  editable: boolean;
  savingUnit: boolean;
  onUnitChange: (unit: CaptureSizeUnit) => void;
  onAspectChange: (preset: AspectPreset, custom?: AspectRatio) => void;
  onCommit: (size: Partial<OutputSize>) => boolean;
}

const ASPECT_OPTIONS: Array<{ value: AspectPreset; label: string }> = [
  { value: "free", label: "自由" },
  { value: "current", label: "当前比例" },
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "custom", label: "自定义…" },
];

function validDimension(value: number | null, min: number, max: number, unit: CaptureSizeUnit): value is number {
  const scale = unit === "px" ? 1 : 10;
  return value !== null && Number.isFinite(value) && Math.round(value * scale) === value * scale && value >= min && value <= max;
}

export default function SelectionSizePanel({
  size, limits, position, unit, aspectPreset, aspectRatio, showInputs, editable, savingUnit,
  onUnitChange, onAspectChange, onCommit,
}: SelectionSizePanelProps) {
  const [width, setWidth] = useState<number | null>(size.width);
  const [height, setHeight] = useState<number | null>(size.height);
  const [customWidth, setCustomWidth] = useState<number | null>(aspectRatio?.width ?? null);
  const [customHeight, setCustomHeight] = useState<number | null>(aspectRatio?.height ?? null);

  useEffect(() => { setWidth(size.width); setHeight(size.height); }, [size.height, size.width]);
  useEffect(() => {
    if (aspectPreset === "custom") {
      setCustomWidth(aspectRatio?.width ?? null);
      setCustomHeight(aspectRatio?.height ?? null);
    }
  }, [aspectPreset, aspectRatio?.height, aspectRatio?.width]);

  const commitWidth = (): void => {
    if (!validDimension(width, limits.minWidth, limits.maxWidth, unit)) return setWidth(size.width);
    if (width !== size.width && !onCommit({ width })) setWidth(size.width);
  };
  const commitHeight = (): void => {
    if (!validDimension(height, limits.minHeight, limits.maxHeight, unit)) return setHeight(size.height);
    if (height !== size.height && !onCommit({ height })) setHeight(size.height);
  };
  const commitCustom = (): void => {
    if (customWidth && customHeight && Number.isFinite(customWidth) && Number.isFinite(customHeight) && customWidth > 0 && customHeight > 0)
      onAspectChange("custom", { width: customWidth, height: customHeight });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, commit: () => void): void => {
    event.stopPropagation();
    if (event.key === "Enter") { event.preventDefault(); commit(); event.currentTarget.blur(); }
  };

  return (
    <div className={`selection-size-panel${showInputs ? "" : " selection-size-panel--readonly"}`} style={position} onMouseDown={(event) => event.stopPropagation()}>
      {showInputs ? <>
        <div className="selection-size-panel__row">
          <div className="selection-size-panel__dimensions">
            <label><InputNumber size="small" prefix="X" aria-label={`选区宽度（${unit.toUpperCase()}）`} controls={false} min={limits.minWidth} max={limits.maxWidth} precision={unit === "px" ? 0 : 1} disabled={!editable} value={width} onChange={setWidth} onBlur={commitWidth} onKeyDown={(event) => onKeyDown(event, commitWidth)} /></label>
            <i>×</i>
            <label><InputNumber size="small" prefix="Y" aria-label={`选区高度（${unit.toUpperCase()}）`} controls={false} min={limits.minHeight} max={limits.maxHeight} precision={unit === "px" ? 0 : 1} disabled={!editable} value={height} onChange={setHeight} onBlur={commitHeight} onKeyDown={(event) => onKeyDown(event, commitHeight)} /></label>
          </div>
          <div className="selection-size-panel__controls">
            <Select<CaptureSizeUnit> aria-label="截图尺寸单位" size="small" value={unit} disabled={!editable || savingUnit}
              options={[{ value: "px", label: "PX" }, { value: "dip", label: "DIP" }]} onChange={onUnitChange} />
            <Select<AspectPreset> aria-label="截图比例" size="small" value={aspectPreset} disabled={!editable}
              options={ASPECT_OPTIONS} onChange={(preset) => onAspectChange(preset)} />
            {aspectPreset === "custom" && <span className="selection-size-panel__custom-ratio">
              <InputNumber size="small" aria-label="自定义比例宽" controls={false} min={0.1} precision={2} disabled={!editable} value={customWidth} onChange={setCustomWidth} onBlur={commitCustom} onKeyDown={(event) => onKeyDown(event, commitCustom)} />
              <i>:</i>
              <InputNumber size="small" aria-label="自定义比例高" controls={false} min={0.1} precision={2} disabled={!editable} value={customHeight} onChange={setCustomHeight} onBlur={commitCustom} onKeyDown={(event) => onKeyDown(event, commitCustom)} />
            </span>}
          </div>
        </div>
      </> : <span>{unit === "px" ? `${size.width} × ${size.height} PX` : `${size.width.toFixed(1)} × ${size.height.toFixed(1)} DIP`}</span>}
    </div>
  );
}
