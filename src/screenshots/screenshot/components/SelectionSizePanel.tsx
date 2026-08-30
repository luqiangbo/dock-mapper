import { InputNumber } from "antd";
import { useEffect, useState, type KeyboardEvent } from "react";
import type { OutputSize, OutputSizeLimits, PanelPosition } from "./selectionSizeGeometry";

export const SELECTION_SIZE_PANEL_SIZE = { width: 184, height: 40 } as const;

interface SelectionSizePanelProps {
  size: OutputSize;
  limits: OutputSizeLimits;
  position: PanelPosition;
  showInputs: boolean;
  editable: boolean;
  onCommit: (size: Partial<OutputSize>) => void;
}

function validDimension(value: number | null, min: number, max: number): value is number {
  return value !== null && Number.isInteger(value) && value >= min && value <= max;
}

export default function SelectionSizePanel({
  size,
  limits,
  position,
  showInputs,
  editable,
  onCommit,
}: SelectionSizePanelProps) {
  const [width, setWidth] = useState<number | null>(size.width);
  const [height, setHeight] = useState<number | null>(size.height);

  useEffect(() => {
    setWidth(size.width);
    setHeight(size.height);
  }, [size.height, size.width]);

  const commitWidth = (): void => {
    if (!validDimension(width, limits.minWidth, limits.maxWidth)) {
      setWidth(size.width);
      return;
    }
    if (width !== size.width) onCommit({ width });
  };
  const commitHeight = (): void => {
    if (!validDimension(height, limits.minHeight, limits.maxHeight)) {
      setHeight(size.height);
      return;
    }
    if (height !== size.height) onCommit({ height });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, commit: () => void): void => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      event.currentTarget.blur();
    }
  };

  return (
    <div
      className={`selection-size-panel${showInputs ? "" : " selection-size-panel--readonly"}`}
      style={position}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {showInputs ? (
        <>
          <label>
            <span>宽</span>
            <InputNumber
              aria-label="选区宽度（输出像素）"
              controls={false}
              min={limits.minWidth}
              max={limits.maxWidth}
              precision={0}
              disabled={!editable}
              value={width}
              onChange={setWidth}
              onBlur={commitWidth}
              onKeyDown={(event) => onKeyDown(event, commitWidth)}
            />
          </label>
          <i>×</i>
          <label>
            <span>高</span>
            <InputNumber
              aria-label="选区高度（输出像素）"
              controls={false}
              min={limits.minHeight}
              max={limits.maxHeight}
              precision={0}
              disabled={!editable}
              value={height}
              onChange={setHeight}
              onBlur={commitHeight}
              onKeyDown={(event) => onKeyDown(event, commitHeight)}
            />
          </label>
        </>
      ) : (
        <span>{size.width} × {size.height}</span>
      )}
    </div>
  );
}
