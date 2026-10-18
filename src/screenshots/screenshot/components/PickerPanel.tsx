import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Card, Tag, Tooltip } from "antd";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  MousePointer2,
  LockKeyhole,
} from "lucide-react";
import type { PickerSample } from "./pickerColor";
import type { PixelPoint } from "./pickerState";
import {
  PICKER_CELL,
  PICKER_LENS_SIZE,
  PICKER_RADIUS,
  pickerLensCrop,
  pickerPanelPosition,
} from "./pickerState";

interface Props {
  image: HTMLCanvasElement;
  sample: PickerSample;
  formatted: string;
  anchor: PixelPoint;
  locked: boolean;
  copying: boolean;
  copied: boolean;
  error: string | null;
  nudge: (dx: number, dy: number) => void;
  copy: () => void;
  follow: () => void;
}
export function PickerPanel({
  image,
  sample,
  formatted,
  anchor,
  locked,
  copying,
  copied,
  error,
  nudge,
  copy,
  follow,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const zoom = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 256, height: 240 });
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  useLayoutEffect(() => {
    if (!panel.current) return;
    const update = () => {
      const rect = panel.current!.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(update);
    observer.observe(panel.current);
    update();
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);
  useEffect(() => {
    const context = zoom.current?.getContext("2d");
    if (!context) return;
    const point = { x: sample.imageX, y: sample.imageY };
    const crop = pickerLensCrop(point, image.width, image.height);
    context.clearRect(0, 0, PICKER_LENS_SIZE, PICKER_LENS_SIZE);
    context.imageSmoothingEnabled = false;
    context.drawImage(
      image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      crop.left,
      crop.top,
      crop.width * PICKER_CELL,
      crop.height * PICKER_CELL,
    );
    context.beginPath();
    for (let i = 1; i < 11; i++) {
      context.moveTo(i * PICKER_CELL + 0.5, 0);
      context.lineTo(i * PICKER_CELL + 0.5, PICKER_LENS_SIZE);
      context.moveTo(0, i * PICKER_CELL + 0.5);
      context.lineTo(PICKER_LENS_SIZE, i * PICKER_CELL + 0.5);
    }
    context.strokeStyle = "rgba(80, 90, 105, .24)";
    context.lineWidth = 1;
    context.stroke();
    const center = PICKER_RADIUS * PICKER_CELL;
    for (const [color, width] of [
      ["#101317", 4],
      ["#ffffff", 2],
    ] as const) {
      context.strokeStyle = color;
      context.lineWidth = width;
      context.strokeRect(center, center, PICKER_CELL, PICKER_CELL);
      context.beginPath();
      for (const [x, y, x2, y2] of [
        [center + 6, center - 19, center + 6, center - 5],
        [center + 6, center + 17, center + 6, center + 31],
        [center - 19, center + 6, center - 5, center + 6],
        [center + 17, center + 6, center + 31, center + 6],
      ]) {
        context.moveTo(x, y);
        context.lineTo(x2, y2);
      }
      context.stroke();
    }
  }, [image, sample.imageX, sample.imageY]);
  const position = pickerPanelPosition(anchor, size, viewport);
  const directions = [
    { label: "上", dx: 0, dy: -1, icon: ArrowUp, disabled: sample.imageY === 0, area: "up" },
    { label: "左", dx: -1, dy: 0, icon: ArrowLeft, disabled: sample.imageX === 0, area: "left" },
    {
      label: "右",
      dx: 1,
      dy: 0,
      icon: ArrowRight,
      disabled: sample.imageX === image.width - 1,
      area: "right",
    },
    {
      label: "下",
      dx: 0,
      dy: 1,
      icon: ArrowDown,
      disabled: sample.imageY === image.height - 1,
      area: "down",
    },
  ];
  return (
    <div
      ref={panel}
      className={`picker-panel-host${locked ? " is-locked" : ""}`}
      style={position}
      data-picker-controls
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      }}
    >
      <Card
        size="small"
        className="picker-panel"
        title={
          <span className="picker-panel__title">
            {locked ? <LockKeyhole size={14} /> : <MousePointer2 size={14} />}像素取色
          </span>
        }
        extra={<Tag bordered={false}>{locked ? "已锁定" : "跟随"}</Tag>}
      >
        <div className="picker-panel__workspace">
          <div className="picker-panel__lens">
            <canvas ref={zoom} width={PICKER_LENS_SIZE} height={PICKER_LENS_SIZE} />
          </div>
          <div className="picker-panel__tools">
            <div className="picker-panel__coordinates" aria-label="选区像素坐标">
              <span>X {sample.imageX}</span>
              <span>Y {sample.imageY}</span>
            </div>
            {locked ? (
              <>
                <div className="picker-panel__nudge">
                  <span className="picker-panel__step">1 px</span>
                  {directions.map(({ label, dx, dy, icon: Icon, disabled, area }) => (
                    <Tooltip key={area} title={`向${label}移动 1 个原图像素`}>
                      <Button
                        type="text"
                        size="small"
                        icon={<Icon size={16} />}
                        aria-label={`向${label}移动 1 像素`}
                        disabled={disabled}
                        style={{ gridArea: area }}
                        onClick={() => nudge(dx, dy)}
                      />
                    </Tooltip>
                  ))}
                </div>
                <Button size="small" onClick={follow}>
                  继续取色
                </Button>
              </>
            ) : (
              <div className="picker-panel__instruction">
                单击锁定
                <br />
                方向键微调
                <br />
                每次 1 px
              </div>
            )}
          </div>
        </div>
        <div className="picker-panel__readout">
          <div className="picker-panel__color">
            <span style={{ backgroundColor: `#${sample.hex}` }} />
            <code>{formatted}</code>
          </div>
          {locked && (
            <Tooltip title="复制颜色（C）">
              <Button
                type="primary"
                size="small"
                icon={<Copy size={14} />}
                loading={copying}
                onClick={copy}
              >
                {copied ? "已复制" : "复制"}
              </Button>
            </Tooltip>
          )}
        </div>
        {error && (
          <div className="picker-panel__error" role="alert">
            {error}
          </div>
        )}
        <div className="picker-panel__hint">
          {locked ? "方向键微调 · C 复制 · 空格继续" : "移动预览 · 单击锁定像素"}
        </div>
      </Card>
    </div>
  );
}
