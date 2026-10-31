import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { calculatePickerPosition, CAPTURE_LOUPE_BOUNDS } from "../components/pickerGeometry";
import { pickerPixel } from "../components/captureInteraction";
import {
  formatPickerColor,
  type ColorCopyFormat,
  type PickerSample,
} from "../components/pickerColor";

const LOUPE_SIZE = 80;

interface Options {
  enabled: boolean;
  initialPoint?: { x: number; y: number };
  generation: number;
  image: HTMLImageElement | null;
  format: ColorCopyFormat;
  grid?: boolean;
  magnification?: number;
  hints?: boolean;
  copy: (sample: PickerSample) => Promise<void>;
  changeFormat: (format: ColorCopyFormat) => void;
  onError: (message: string) => void;
}

/** Samples the frozen source, never the dimmed overlay or a cropped editor canvas. */
export function useCaptureLoupe(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [sample, setSample] = useState<PickerSample | null>(null);
  const [copied, setCopied] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sampleRef = useRef<PickerSample | null>(null);
  const request = useRef(0);
  useEffect(() => {
    let frame = 0,
      timer = 0,
      shiftOnly = false,
      buttons = 0;
    let point: { x: number; y: number } | null = options.initialPoint ?? {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    };
    let disposed = false;
    sampleRef.current = null;
    setSample(null);
    setCopied(false);
    const sampler = document.createElement("canvas");
    sampler.width = sampler.height = 1;
    const context = sampler.getContext("2d", { willReadFrequently: true });
    const flush = () => {
      frame = 0;
      const current = latest.current;
      if (!current.enabled || !current.image || !context || !point) return;
      const pixel = pickerPixel(
        point.x,
        point.y,
        current.image.naturalWidth,
        current.image.naturalHeight,
        window.innerWidth,
        window.innerHeight,
      );
      try {
        context.clearRect(0, 0, 1, 1);
        context.drawImage(current.image, pixel.x, pixel.y, 1, 1, 0, 0, 1, 1);
        const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
        const value: PickerSample = {
          red,
          green,
          blue,
          imageX: pixel.x,
          imageY: pixel.y,
          hex: [red, green, blue]
            .map((v) => v.toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase(),
          ...calculatePickerPosition(
            point.x,
            point.y,
            window.innerWidth,
            window.innerHeight,
            CAPTURE_LOUPE_BOUNDS,
          ),
        };
        sampleRef.current = value;
        setSample(value);
      } catch (error) {
        current.onError(`像素读取失败：${String(error)}`);
      }
    };
    const move = (event: PointerEvent) => {
      buttons = event.buttons;
      if (buttons) shiftOnly = false;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(".wx-toolbar, .tool-options, .ant-popover, .ant-dropdown, input, textarea")
      )
        return;
      point = { x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const keydown = (event: KeyboardEvent) => {
      const current = latest.current;
      if (
        !current.enabled ||
        event.isComposing ||
        event.key === "Process" ||
        event.defaultPrevented ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]',
          ))
      )
        return;
      if (
        event.key === "Shift" &&
        !event.repeat &&
        !buttons &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      )
        shiftOnly = true;
      else if (event.key !== "Shift") shiftOnly = false;
      if (
        event.key.toLowerCase() !== "c" ||
        event.shiftKey ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      )
        return;
      flush();
      const value = sampleRef.current;
      if (!value || event.repeat) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const id = ++request.current;
      void current
        .copy(value)
        .then(() => {
          if (disposed || id !== request.current) return;
          setCopied(true);
          window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            if (!disposed) setCopied(false);
          }, 900);
        })
        .catch((error) => {
          if (!disposed && id === request.current)
            current.onError(`颜色复制失败：${String(error)}`);
        });
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key !== "Shift") return;
      if (
        event.isComposing ||
        (event.target instanceof Element &&
          event.target.closest('input,textarea,[contenteditable="true"]'))
      ) {
        shiftOnly = false;
        return;
      }
      if (shiftOnly && !buttons && !event.ctrlKey && !event.altKey && !event.metaKey) {
        const formats: ColorCopyFormat[] = ["hex", "rgb", "hsl", "hsv", "css"];
        latest.current.changeFormat(
          formats[(formats.indexOf(latest.current.format) + 1) % formats.length],
        );
      }
      shiftOnly = false;
    };
    const blur = () => {
      shiftOnly = false;
      buttons = 0;
    };
    const down = (event: PointerEvent) => {
      buttons = event.buttons;
      shiftOnly = false;
    };
    const up = (event: PointerEvent) => {
      buttons = event.buttons;
    };
    if (options.enabled) {
      frame = requestAnimationFrame(flush);
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerdown", down, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("keydown", keydown, true);
      window.addEventListener("keyup", keyup, true);
      window.addEventListener("blur", blur);
    }
    return () => {
      disposed = true;
      request.current++;
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", blur);
    };
  }, [options.enabled, options.generation]);

  useLayoutEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context || !sample || !options.image) return;
    const count = Math.max(5, Math.round(LOUPE_SIZE / (options.magnification ?? 8))) | 1;
    const left = sample.imageX - Math.floor(count / 2),
      top = sample.imageY - Math.floor(count / 2);
    context.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);
    context.imageSmoothingEnabled = false;
    context.drawImage(options.image, left, top, count, count, 0, 0, LOUPE_SIZE, LOUPE_SIZE);
    if (options.grid !== false) {
      context.strokeStyle = "rgba(128,128,128,.45)";
      context.lineWidth = 0.5;
      context.beginPath();
      for (let i = 0; i <= count; i++) {
        const p = (i * LOUPE_SIZE) / count;
        context.moveTo(p, 0);
        context.lineTo(p, LOUPE_SIZE);
        context.moveTo(0, p);
        context.lineTo(LOUPE_SIZE, p);
      }
      context.stroke();
    }
  }, [sample, options.image, options.grid, options.magnification]);

  const cell =
    LOUPE_SIZE / (Math.max(5, Math.round(LOUPE_SIZE / (options.magnification ?? 8))) | 1);
  return options.enabled && sample ? (
    <div
      className="picker-preview picker-preview--capture"
      style={{ left: sample.left, top: sample.top, ...CAPTURE_LOUPE_BOUNDS, pointerEvents: "none" }}
    >
      <div className="picker-preview__zoom" style={{ width: LOUPE_SIZE, height: LOUPE_SIZE }}>
        <canvas ref={canvas} width={LOUPE_SIZE} height={LOUPE_SIZE} />
        <span
          style={{
            width: cell,
            height: cell,
            left: (LOUPE_SIZE - cell) / 2,
            top: (LOUPE_SIZE - cell) / 2,
          }}
        />
      </div>
      <div className="picker-preview__meta">
        <div className="picker-preview__color-row">
          <i style={{ background: `#${sample.hex}` }} />
          <strong>{copied ? "已复制" : formatPickerColor(sample, options.format)}</strong>
        </div>
        <span className="picker-preview__coordinates">
          {sample.imageX}, {sample.imageY}
        </span>
        {options.hints && (
          <span className="picker-preview__hint">
            <kbd>C</kbd> 复制 · <kbd>Shift</kbd> 格式
          </span>
        )}
      </div>
    </div>
  ) : null;
}
