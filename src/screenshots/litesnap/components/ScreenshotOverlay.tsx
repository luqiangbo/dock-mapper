import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Selection } from "../store";
import { useStore } from "../store";
import { useI18n } from "../i18n";
import type { OcrResult } from "../api";
import type { ScreenshotConfig } from "../../../types";
import AnnotationToolbar, { STROKE_COLORS, type AnnotTool } from "./AnnotationToolbar";
import { loadImageFromUrl, loadPngFromBase64 } from "../utils/scrollStitch";
import {
  fontFamily,
  TEXT_SIZES,
  type TextEditorState,
  type TextObject,
  type TextSize,
} from "./textTypes";
import ToolOptionsBar from "./ToolOptionsBar";
import {
  DEFAULT_NUMBER_STYLE,
  DEFAULT_TEXT_STYLE,
  type ArrowStyle,
  type NumberStyle,
  type ToolSettings,
} from "./annotationTypes";

const MIN_SIZE = 8;
const TOOLBAR_WIDTH = 720;

interface PickerSample {
  hex: string;
  red: number;
  green: number;
  blue: number;
  imageX: number;
  imageY: number;
  left: number;
  top: number;
}

interface OcrPanelState {
  result: OcrResult | null;
  error: string | null;
  pending: boolean;
  elapsedMs: number | null;
}

interface NumberObject {
  id: string;
  value: number;
  canvasX: number;
  canvasY: number;
  style: NumberStyle;
}

const EMPTY_OCR: OcrPanelState = { result: null, error: null, pending: false, elapsedMs: null };

type ColorCopyFormat = ScreenshotConfig["color_copy_format"];

function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(lightness * 100)];
  const delta = max - min;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return [
    Math.round((hue * 60 + 360) % 360),
    Math.round(saturation * 100),
    Math.round(lightness * 100),
  ];
}

function rgbToHsv(red: number, green: number, blue: number): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  return [
    Math.round((hue * 60 + 360) % 360),
    Math.round((max ? delta / max : 0) * 100),
    Math.round(max * 100),
  ];
}

function formatPickerColor(sample: PickerSample, format: ColorCopyFormat): string {
  const { red, green, blue } = sample;
  if (format === "hex") return `#${sample.hex}`;
  if (format === "rgb") return `rgb(${red}, ${green}, ${blue})`;
  if (format === "css")
    return `color(srgb ${Math.round((red / 255) * 100)}% ${Math.round((green / 255) * 100)}% ${Math.round((blue / 255) * 100)}%)`;
  if (format === "hsl") {
    const [hue, saturation, lightness] = rgbToHsl(red, green, blue);
    return `hsl(${hue} ${saturation}% ${lightness}%)`;
  }
  const [hue, saturation, value] = rgbToHsv(red, green, blue);
  return `hsv(${hue} ${saturation}% ${value}%)`;
}

const RESIZE_HANDLES = ["nw", "n", "ne", "w", "e", "sw", "s", "se"] as const;
type ResizeHandle = (typeof RESIZE_HANDLES)[number];

const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: "nwse-resize",
  n: "ns-resize",
  ne: "nesw-resize",
  w: "ew-resize",
  e: "ew-resize",
  sw: "nesw-resize",
  s: "ns-resize",
  se: "nwse-resize",
};

function resizeRect(origin: Selection, handle: ResizeHandle, dx: number, dy: number): Selection {
  const right = origin.x + origin.width;
  const bottom = origin.y + origin.height;
  let { x, y, width, height } = origin;

  if (handle.includes("w")) {
    x = Math.max(0, Math.min(origin.x + dx, right - MIN_SIZE));
    width = right - x;
  }
  if (handle.includes("e")) {
    width = Math.max(MIN_SIZE, Math.min(right + dx, window.innerWidth) - x);
  }
  if (handle.includes("n")) {
    y = Math.max(0, Math.min(origin.y + dy, bottom - MIN_SIZE));
    height = bottom - y;
  }
  if (handle.includes("s")) {
    height = Math.max(MIN_SIZE, Math.min(bottom + dy, window.innerHeight) - y);
  }
  return { x, y, width, height };
}

function moveRect(origin: Selection, dx: number, dy: number): Selection {
  const x = Math.max(0, Math.min(origin.x + dx, window.innerWidth - origin.width));
  const y = Math.max(0, Math.min(origin.y + dy, window.innerHeight - origin.height));
  return { ...origin, x, y };
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function strokeHighlightPath(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  color: string,
  lineWidth: number,
  opacity: number,
): void {
  if (points.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.strokeStyle = hexToRgba(color, opacity);
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.restore();
}

function normalizeRect(x1: number, y1: number, x2: number, y2: number): Selection {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

function clampPoint(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, window.innerWidth)),
    y: Math.max(0, Math.min(y, window.innerHeight)),
  };
}

function clampSelection(rect: Selection): Selection {
  const maxW = window.innerWidth;
  const maxH = window.innerHeight;
  const x = Math.max(0, Math.min(rect.x, maxW - MIN_SIZE));
  const y = Math.max(0, Math.min(rect.y, maxH - MIN_SIZE));
  const width = Math.max(MIN_SIZE, Math.min(rect.width, maxW - x));
  const height = Math.max(MIN_SIZE, Math.min(rect.height, maxH - y));
  return { x, y, width, height };
}

function syncImageScale(image: HTMLImageElement): { scaleX: number; scaleY: number } {
  return {
    scaleX: image.naturalWidth / Math.max(1, window.innerWidth),
    scaleY: image.naturalHeight / Math.max(1, window.innerHeight),
  };
}

// Windows benefits from two paint opportunities before revealing the native
// overlay, but macOS pauses requestAnimationFrame for a hidden WebView. Always
// resolve through a short timer as a fallback so the hidden capture window can
// never wait forever and fail to open.
function waitForOverlayPaint(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };
    timer = window.setTimeout(finish, 16);
    requestAnimationFrame(() => {
      requestAnimationFrame(finish);
    });
  });
}

function selectionToImageCrop(
  rect: Selection,
  image: HTMLImageElement,
  heightOverride?: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const { scaleX, scaleY } = syncImageScale(image);
  const logicalH = heightOverride ?? rect.height;
  let sx = Math.floor(rect.x * scaleX);
  let sy = Math.floor(rect.y * scaleY);
  let sw = Math.ceil((rect.x + rect.width) * scaleX) - sx;
  let sh = Math.ceil((rect.y + logicalH) * scaleY) - sy;
  sx = Math.max(0, Math.min(sx, image.naturalWidth - 1));
  sy = Math.max(0, Math.min(sy, image.naturalHeight - 1));
  sw = Math.max(1, Math.min(sw, image.naturalWidth - sx));
  sh = Math.max(1, Math.min(sh, image.naturalHeight - sy));
  return { sx, sy, sw, sh };
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  style: ArrowStyle = "filled",
  headScale = 1,
): void {
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length < 1) return;
  const head = Math.min(Math.max(ctx.lineWidth * 4.8 * headScale, 12 * headScale), length * 0.42);
  const wingAngle = Math.PI / 6;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const inset = style === "filled" || style === "double" ? head * 0.78 : 0;
  const startX = style === "double" ? x1 + inset * Math.cos(angle) : x1;
  const startY = style === "double" ? y1 + inset * Math.sin(angle) : y1;
  const endX = style === "filled" || style === "double" ? x2 - inset * Math.cos(angle) : x2;
  const endY = style === "filled" || style === "double" ? y2 - inset * Math.sin(angle) : y2;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  const arrowHead = (x: number, y: number, direction: number, filled: boolean): void => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      x - head * Math.cos(direction - wingAngle),
      y - head * Math.sin(direction - wingAngle),
    );
    ctx.lineTo(
      x - head * Math.cos(direction + wingAngle),
      y - head * Math.sin(direction + wingAngle),
    );
    if (filled) {
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.stroke();
    }
  };
  if (style === "filled") arrowHead(x2, y2, angle, true);
  if (style === "outline") arrowHead(x2, y2, angle, false);
  if (style === "double") {
    arrowHead(x2, y2, angle, true);
    arrowHead(x1, y1, angle + Math.PI, true);
  }
  ctx.restore();
}

function applyMosaic(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  block = 10,
): void {
  const sx = Math.max(0, Math.floor(x));
  const sy = Math.max(0, Math.floor(y));
  const sw = Math.max(1, Math.floor(w));
  const sh = Math.max(1, Math.floor(h));
  if (sw < 2 || sh < 2) return;
  const imageData = ctx.getImageData(sx, sy, sw, sh);
  const { data, width, height } = imageData;
  for (let by = 0; by < height; by += block) {
    for (let bx = 0; bx < width; bx += block) {
      let r = 0,
        g = 0,
        b = 0,
        count = 0;
      const bw = Math.min(block, width - bx);
      const bh = Math.min(block, height - by);
      for (let yy = 0; yy < bh; yy++) {
        for (let xx = 0; xx < bw; xx++) {
          const i = ((by + yy) * width + (bx + xx)) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
      }
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);
      for (let yy = 0; yy < bh; yy++) {
        for (let xx = 0; xx < bw; xx++) {
          const i = ((by + yy) * width + (bx + xx)) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
        }
      }
    }
  }
  ctx.putImageData(imageData, sx, sy);
}

function ScreenshotOverlay(): React.JSX.Element {
  const { t } = useI18n();
  const bgRef = useRef<HTMLCanvasElement>(null);
  const shotRef = useRef<HTMLCanvasElement>(null);
  const shotViewportRef = useRef<HTMLDivElement>(null);
  const fullImageRef = useRef<HTMLImageElement | null>(null);
  const colorSampleCanvas = useRef<HTMLCanvasElement | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const drawOrigin = useRef({ x: 0, y: 0 });
  const history = useRef<ImageData[]>([]);
  const penDrawing = useRef(false);
  const highlightDrawing = useRef(false);
  const highlightPoints = useRef<Array<{ x: number; y: number }>>([]);
  const scrollCapturing = useRef(false);
  const scrollResultReceived = useRef(false);
  const pendingAction = useRef(0);
  // 递增令牌使得选区变化、关闭或新截图后的迟到 OCR 结果立即失效。
  const ocrRequest = useRef(0);
  const initialSelectionHeight = useRef(0);
  const imageScaleRef = useRef({ scaleX: 1, scaleY: 1 });
  const lastTextFontSize = useRef<TextSize>(TEXT_SIZES[1]);
  const nextNumber = useRef(1);
  const textDragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    originCanvasX: number;
    originCanvasY: number;
  } | null>(null);
  const textEditorDragRef = useRef<{
    startX: number;
    startY: number;
    originCanvasX: number;
    originCanvasY: number;
  } | null>(null);
  const numberDragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    originCanvasX: number;
    originCanvasY: number;
  } | null>(null);
  const regionDragRef = useRef<{
    handle: ResizeHandle | "move";
    startX: number;
    startY: number;
    origin: Selection;
    // Pixels captured when the drag began, so shrinking then re-growing the
    // region restores annotations instead of losing them.
    baseCanvas: HTMLCanvasElement;
    baseSx: number;
    baseSy: number;
    baseTextObjects: TextObject[];
  } | null>(null);

  const [phase, setPhase] = useState<"loading" | "selecting" | "editing">("loading");
  const [dragging, setDragging] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shotReady, setShotReady] = useState(false);
  const [tool, setTool] = useState<AnnotTool>(null);
  const [strokeColor, setStrokeColor] = useState<string>(STROKE_COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [fillOpacity, setFillOpacity] = useState(0);
  const [arrowHeadSize, setArrowHeadSize] = useState(1);
  const [penWidth, setPenWidth] = useState(3);
  const [highlightWidth, setHighlightWidth] = useState(20);
  const [highlightOpacity, setHighlightOpacity] = useState(0.32);
  const [mosaicBlock, setMosaicBlock] = useState(12);
  const [textStyle, setTextStyle] = useState(DEFAULT_TEXT_STYLE);
  const [numberStyle, setNumberStyle] = useState(DEFAULT_NUMBER_STYLE);
  const [canUndo, setCanUndo] = useState(false);
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [textObjects, setTextObjects] = useState<TextObject[]>([]);
  const [numberObjects, setNumberObjects] = useState<NumberObject[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [selectedNumberId, setSelectedNumberId] = useState<string | null>(null);
  const [editHeight, setEditHeight] = useState(0);
  const [viewScrollTop, setViewScrollTop] = useState(0);
  const [adjustingRegion, setAdjustingRegion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerSample, setPickerSample] = useState<PickerSample | null>(null);
  const [pickerCopied, setPickerCopied] = useState(false);
  const [pickerFormat, setPickerFormat] = useState<ColorCopyFormat>("hex");
  const [ocrPanel, setOcrPanel] = useState<OcrPanelState>(EMPTY_OCR);
  const [qrContents, setQrContents] = useState<string[] | null>(null);
  const [arrowStyle, setArrowStyle] = useState<ArrowStyle>("filled");
  const [ocrRunning, setOcrRunning] = useState(false);

  const selection = useStore((s) => s.selection);
  const setSelection = useStore((s) => s.setSelection);

  useEffect(() => {
    ocrRequest.current += 1;
    setOcrRunning(false);
    setOcrPanel(EMPTY_OCR);
    setQrContents(null);
  }, [selection?.x, selection?.y, selection?.width, selection?.height]);

  useEffect(() => {
    void window.api
      .getScreenshotConfig()
      .then((config) => {
        setPickerFormat(config.color_copy_format);
      })
      .catch(() => undefined);
  }, []);

  const copyPickerColor = useCallback(async () => {
    const sample = pickerSample;
    if (!sample) return;
    await window.api.copyText(formatPickerColor(sample, pickerFormat));
    setPickerCopied(true);
    window.setTimeout(() => setPickerCopied(false), 900);
  }, [pickerFormat, pickerSample]);

  const copyPickerHex = useCallback(async () => {
    if (!pickerSample) return;
    await window.api.copyText(pickerSample.hex);
    setPickerCopied(true);
    window.setTimeout(() => setPickerCopied(false), 900);
  }, [pickerSample]);

  const displayHeight = selection ? editHeight || selection.height : 0;
  // Scroll capture starts a fresh frame-stitching pipeline. Mixing that pipeline
  // with an annotated canvas corrupts its baseline and can leave the overlay busy
  // forever, so only allow it while the selected crop is still untouched.
  const hasAnnotations =
    canUndo || textObjects.length > 0 || numberObjects.length > 0 || textEditor !== null || drawing;
  const isLongImage =
    initialSelectionHeight.current > 0 && displayHeight > initialSelectionHeight.current + 2;
  // A stitched long screenshot is no longer a plain crop of the frozen frame,
  // so the region can only be re-cropped for ordinary captures.
  const canAdjustRegion = phase === "editing" && shotReady && !busy && !isLongImage && !tool;

  const paintBackground = useCallback(
    (rect: Selection | null, holeHeight?: number, scrollTop = 0, showStroke = true) => {
      const canvas = bgRef.current;
      const image = fullImageRef.current;
      if (!canvas || !image) return;
      imageScaleRef.current = syncImageScale(image);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fillRect(0, 0, width, height);
      if (rect && rect.width > 0 && rect.height > 0) {
        const visibleHeight = holeHeight ?? rect.height;
        const { sx, sy, sw, sh } = selectionToImageCrop(rect, image, visibleHeight);
        const { scaleY } = imageScaleRef.current;
        const scrollOffset = Math.floor(scrollTop * scaleY);
        const holeSy = Math.max(0, sy - scrollOffset);
        const shot = shotRef.current;
        const useShot = shot && visibleHeight > initialSelectionHeight.current + 2;

        if (useShot) {
          const srcY = Math.max(0, Math.floor((scrollTop / visibleHeight) * shot.height));
          const srcH = Math.max(1, shot.height - srcY);
          ctx.drawImage(shot, 0, srcY, shot.width, srcH, sx, holeSy, sw, sh);
        } else {
          ctx.drawImage(image, sx, sy, sw, sh, sx, sy, sw, sh);
        }
        if (showStroke) {
          ctx.strokeStyle = "#6366f1";
          ctx.lineWidth = 2;
          const strokeY = useShot ? holeSy : sy;
          ctx.strokeRect(sx + 1, strokeY + 1, sw - 2, sh - 2);
        }
      }
    },
    [],
  );

  const pushHistory = useCallback(() => {
    const canvas = shotRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    history.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (history.current.length > 30) history.current.shift();
    setCanUndo(history.current.length > 0);
  }, []);

  const undo = useCallback(() => {
    const canvas = shotRef.current;
    const snapshot = history.current.pop();
    if (!canvas || !snapshot) return;
    canvas.getContext("2d")?.putImageData(snapshot, 0, 0);
    setCanUndo(history.current.length > 0);
  }, []);

  useEffect(() => {
    const offResult = window.api.onScrollCaptureResult((result) => {
      if (!scrollCapturing.current || !selection) return;
      scrollResultReceived.current = true;
      void (async () => {
        try {
          const image = await loadPngFromBase64(result.base64);
          const canvas = shotRef.current;
          if (!canvas) return;
          canvas.width = result.imageWidth;
          canvas.height = result.imageHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(image, 0, 0);
          const finalHeight =
            (result.imageHeight / Math.max(1, result.imageWidth)) * selection.width;
          setEditHeight(finalHeight);
          setViewScrollTop(0);
          history.current = [];
          setCanUndo(false);
          paintBackground({ ...selection, height: finalHeight }, finalHeight, 0);
          scrollCapturing.current = false;
          setBusy(false);
          await waitForOverlayPaint();
          await window.api.showCaptureOverlay();
          requestAnimationFrame(() => {
            const viewport = shotViewportRef.current;
            // The completed long screenshot should open at its beginning so
            // the user can inspect the capture from top to bottom. Previously
            // this jumped straight to the tail, making it look as if the
            // beginning had not been captured.
            if (viewport) viewport.scrollTop = 0;
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to decode long screenshot");
          scrollCapturing.current = false;
          setBusy(false);
          void window.api.showCaptureOverlay();
        }
      })();
    });
    const offDone = window.api.onScrollCaptureFinished(() => {
      if (scrollResultReceived.current) return;
      scrollCapturing.current = false;
      setBusy(false);
      void window.api.showCaptureOverlay();
    });
    const offCancel = window.api.onScrollCaptureCancelled(() => {
      scrollCapturing.current = false;
      scrollResultReceived.current = false;
      setBusy(false);
    });
    return () => {
      offResult();
      offDone();
      offCancel();
    };
  }, [selection, paintBackground]);

  const exportPng = useCallback(async (): Promise<Uint8Array> => {
    const canvas = shotRef.current;
    if (!canvas) throw new Error("No canvas");

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0);
    for (const obj of textObjects) {
      const fontPx = Math.round(obj.fontSize * obj.scale);
      const width = Math.max(1, obj.width * obj.scale);
      const lineHeight = Math.round(fontPx * 1.25);
      ctx.fillStyle = hexToRgba(obj.backgroundColor, obj.backgroundOpacity);
      ctx.fillRect(
        obj.canvasX,
        obj.canvasY,
        width,
        Math.max(obj.height * obj.scale, lineHeight + 12),
      );
      ctx.fillStyle = obj.color;
      ctx.font = `${obj.bold ? "700" : "400"} ${fontPx}px ${fontFamily(obj.font)}`;
      ctx.textBaseline = "top";
      ctx.lineWidth = Math.max(0, obj.strokeWidth * obj.scale);
      ctx.strokeStyle = obj.strokeColor;
      const words = obj.text.split(/(\s+)/);
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        if (word.includes("\n")) {
          const parts = word.split("\n");
          line += parts.shift() ?? "";
          lines.push(line);
          line = parts.join("\n");
          continue;
        }
        if (ctx.measureText(line + word).width > width - 12 && line.trim()) {
          lines.push(line.trimEnd());
          line = word.trimStart();
        } else line += word;
      }
      lines.push(line);
      lines.forEach((value, index) => {
        const y = obj.canvasY + 6 + index * lineHeight;
        if (ctx.lineWidth) ctx.strokeText(value, obj.canvasX + 6, y);
        ctx.fillText(value, obj.canvasX + 6, y);
      });
    }
    for (const number of numberObjects) {
      const radius = Math.max(
        12,
        Math.round(
          (number.style.size * canvas.width) / Math.max(1, selection?.width ?? canvas.width) / 2,
        ),
      );
      ctx.fillStyle = number.style.backgroundColor;
      ctx.beginPath();
      ctx.arc(number.canvasX, number.canvasY, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = number.style.textColor;
      ctx.font = `700 ${Math.round(radius * 1.05)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(number.value), number.canvasX, number.canvasY + 1);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      exportCanvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/png",
      );
    });
    return new Uint8Array(await blob.arrayBuffer());
  }, [textObjects, numberObjects, selection?.width]);

  const exportOcrPng = useCallback(async (): Promise<Uint8Array> => {
    const canvas = shotRef.current;
    if (!canvas) throw new Error("No canvas");
    const source = document.createElement("canvas");
    const ctx = source.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.imageSmoothingEnabled = false;
    const frozenImage = fullImageRef.current;
    // 常规截图可始终从冻结原图重新裁切，避免矩形、画笔、文字等标注影响 OCR。
    // 长截图是独立的拼接结果，且启动滚动前已禁止有标注，因此可安全读取其画布。
    if (frozenImage && selection && !isLongImage) {
      const { sx, sy, sw, sh } = selectionToImageCrop(selection, frozenImage);
      source.width = sw;
      source.height = sh;
      ctx.drawImage(frozenImage, sx, sy, sw, sh, 0, 0, sw, sh);
    } else {
      source.width = canvas.width;
      source.height = canvas.height;
      ctx.drawImage(canvas, 0, 0);
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      source.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("toBlob failed"))),
        "image/png",
      );
    });
    return new Uint8Array(await blob.arrayBuffer());
  }, [isLongImage, selection]);

  const recognizeSelection = useCallback(() => {
    if (!selection || !shotReady || ocrRunning) return;
    const request = ++ocrRequest.current;
    setOcrPanel({ result: null, error: null, pending: true, elapsedMs: null });
    setOcrRunning(true);
    void (async () => {
      try {
        const png = await exportOcrPng();
        const startedAt = performance.now();
        const result = await window.api.recognizeSelection(png);
        if (request !== ocrRequest.current) return;
        setOcrPanel({
          result,
          error: null,
          pending: false,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      } catch (err) {
        if (request !== ocrRequest.current) return;
        setError(err instanceof Error ? err.message : t.ocr.exportFailed);
        setOcrPanel({
          result: null,
          error: err instanceof Error ? err.message : t.ocr.engineFailed,
          pending: false,
          elapsedMs: null,
        });
      } finally {
        if (request === ocrRequest.current) setOcrRunning(false);
      }
    })();
  }, [exportOcrPng, ocrRunning, selection, shotReady, t.ocr.engineFailed, t.ocr.exportFailed]);

  const cancelOverlay = useCallback(() => {
    // Invalidate an export that is still waiting for canvas encoding before it
    // reaches the native pin/save/copy command.
    pendingAction.current += 1;
    ocrRequest.current += 1;
    setOcrRunning(false);
    setOcrPanel(EMPTY_OCR);
    setBusy(false);
    window.api.closeOverlay();
  }, []);

  const screenToCanvas = useCallback(
    (left: number, top: number): { canvasX: number; canvasY: number } => {
      const canvas = shotRef.current;
      if (!canvas || !selection) return { canvasX: 0, canvasY: 0 };
      const scale = canvas.width / Math.max(1, selection.width);
      const viewport = shotViewportRef.current;
      const scrollTop = viewport?.scrollTop ?? 0;
      return {
        canvasX: (left - selection.x) * scale,
        canvasY: (top - selection.y + scrollTop) * scale,
      };
    },
    [selection],
  );

  const commitText = useCallback(
    (value: string, screenLeft?: number, screenTop?: number) => {
      const draft = value.trim();
      if (!textEditor) {
        setTextEditor(null);
        setTextDraft("");
        return;
      }
      if (draft) {
        const point =
          screenLeft !== undefined && screenTop !== undefined
            ? screenToCanvas(screenLeft, screenTop)
            : { canvasX: textEditor.canvasX, canvasY: textEditor.canvasY };
        const next: TextObject = {
          id: textEditor.id ?? `text-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          text: draft,
          canvasX: point.canvasX,
          canvasY: point.canvasY,
          scale: textEditor.scale,
          width: textEditor.width,
          height: textEditor.height,
          fontSize: textEditor.fontSize,
          color: textEditor.color,
          font: textEditor.font,
          bold: textEditor.bold,
          strokeColor: textEditor.strokeColor,
          strokeWidth: textEditor.strokeWidth,
          backgroundColor: textEditor.backgroundColor,
          backgroundOpacity: textEditor.backgroundOpacity,
        };
        setTextObjects((prev) => {
          const idx = prev.findIndex((item) => item.id === next.id);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = next;
            return copy;
          }
          return [...prev, next];
        });
        setSelectedTextId(next.id);
      }
      setTextEditor(null);
      setTextDraft("");
    },
    [textEditor, screenToCanvas],
  );

  const cancelTextEditor = useCallback(() => {
    setTextEditor(null);
    setTextDraft("");
  }, []);

  const openTextObjectEditor = useCallback(
    (obj: TextObject) => {
      const canvas = shotRef.current;
      if (!canvas || !selection) return;
      const scale = canvas.width / Math.max(1, selection.width);
      const viewport = shotViewportRef.current;
      const scrollTop = viewport?.scrollTop ?? 0;
      const textLeft = selection.x + obj.canvasX / scale;
      const textTop = selection.y + obj.canvasY / scale - scrollTop;
      setSelectedTextId(obj.id);
      setTextDraft(obj.text);
      setTextEditor({
        id: obj.id,
        canvasX: obj.canvasX,
        canvasY: obj.canvasY,
        left: Math.max(8, textLeft),
        top: Math.max(8, textTop),
        scale: obj.scale,
        width: obj.width,
        height: obj.height,
        fontSize: obj.fontSize,
        color: obj.color,
        font: obj.font,
        bold: obj.bold,
        strokeColor: obj.strokeColor,
        strokeWidth: obj.strokeWidth,
        backgroundColor: obj.backgroundColor,
        backgroundOpacity: obj.backgroundOpacity,
      });
      lastTextFontSize.current = obj.fontSize;
      setStrokeColor(obj.color);
      setTextStyle({
        fontSize: obj.fontSize,
        color: obj.color,
        font: obj.font,
        bold: obj.bold,
        strokeColor: obj.strokeColor,
        strokeWidth: obj.strokeWidth,
        backgroundColor: obj.backgroundColor,
        backgroundOpacity: obj.backgroundOpacity,
      });
      setTool("text");
    },
    [selection],
  );

  // The native window is prewarmed and stays alive between captures. Receiving
  // a capture-ready event avoids reloading the whole WebView on every shortcut.
  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    const overlayLabel = getCurrentWindow().label;
    const loadCapture = async (): Promise<void> => {
      const current = ++revision;
      try {
        const shot = await window.api.getFullScreenshot(overlayLabel);
        if (shot.overlayLabel !== overlayLabel) return;
        if (cancelled || current !== revision) return;
        const img = await loadImageFromUrl(shot.url);
        if (cancelled || current !== revision) return;
        setPhase("loading");
        setSelection(null);
        setTool(null);
        setPickerSample(null);
        setShotReady(false);
        setBusy(false);
        setEditHeight(0);
        setViewScrollTop(0);
        setTextObjects([]);
        setNumberObjects([]);
        nextNumber.current = 1;
        setTextEditor(null);
        setTextDraft("");
        setSelectedTextId(null);
        setSelectedNumberId(null);
        history.current = [];
        setCanUndo(false);
        fullImageRef.current = img;
        imageScaleRef.current = syncImageScale(img);
        const canvas = bgRef.current;
        if (!canvas) return;
        canvas.width = shot.imageWidth;
        canvas.height = shot.imageHeight;
        imageScaleRef.current = syncImageScale(img);
        paintBackground(null);
        setPhase("selecting");
        setError(null);
        await waitForOverlayPaint();
        if (cancelled || current !== revision) return;
        await window.api.reportCaptureRendered(shot.generation, overlayLabel);
      } catch (err) {
        // A prewarmed overlay has no image until the first capture; waiting
        // for the ready event is expected and must not surface an error.
        if (!cancelled && !String(err).includes("No screenshot is available")) {
          setError(err instanceof Error ? err.message : "Failed to load screenshot");
          setPhase("selecting");
        }
      }
    };
    const offCaptureReady = window.api.onCaptureReady((label) => {
      if (label === overlayLabel) void loadCapture();
    });
    const readyTimer = window.setTimeout(() => void window.api.overlayReady(overlayLabel), 50);
    return () => {
      cancelled = true;
      window.clearTimeout(readyTimer);
      offCaptureReady();
    };
  }, [paintBackground, setSelection]);

  useEffect(() => {
    if (phase === "loading") return;
    if (phase === "editing" && selection) {
      paintBackground(selection, editHeight || selection.height, viewScrollTop);
      return;
    }
    paintBackground(selection);
  }, [selection, phase, editHeight, viewScrollTop, paintBackground]);

  const enterEditMode = useCallback(
    (rect: Selection) => {
      const image = fullImageRef.current;
      const bg = bgRef.current;
      if (!image || !bg) {
        setError("Screenshot not ready");
        return;
      }

      const clamped = clampSelection(rect);
      imageScaleRef.current = syncImageScale(image);

      setPhase("editing");
      setEditHeight(clamped.height);
      initialSelectionHeight.current = clamped.height;
      setViewScrollTop(0);
      setTool(null);
      setShotReady(false);
      setTextObjects([]);
      setNumberObjects([]);
      nextNumber.current = 1;
      setSelectedTextId(null);
      setSelectedNumberId(null);
      setTextEditor(null);
      setTextDraft("");
      setSelection(clamped);
      paintBackground(clamped, clamped.height, 0, true);

      // Crop synchronously from the already-frozen image — unlock tools immediately after
      requestAnimationFrame(() => {
        const canvas = shotRef.current;
        if (!canvas) {
          setError("Editor canvas missing");
          return;
        }
        const { sx, sy, sw, sh } = selectionToImageCrop(clamped, image);

        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
        history.current = [];
        setCanUndo(false);
        setShotReady(true);
        setError(null);
      });
    },
    [paintBackground, setSelection],
  );

  // Re-derives the crop for a new region: fills it from the frozen screenshot,
  // then stamps the drag's starting pixels back on top so annotations survive.
  const recropSelection = useCallback(
    (next: Selection) => {
      const image = fullImageRef.current;
      const canvas = shotRef.current;
      const drag = regionDragRef.current;
      if (!image || !canvas || !drag) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { sx, sy, sw, sh } = selectionToImageCrop(next, image);
      canvas.width = sw;
      canvas.height = sh;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);

      const dx = drag.baseSx - sx;
      const dy = drag.baseSy - sy;
      ctx.drawImage(drag.baseCanvas, dx, dy);

      setTextObjects(
        drag.baseTextObjects.map((item) => ({
          ...item,
          canvasX: item.canvasX + dx,
          canvasY: item.canvasY + dy,
        })),
      );

      initialSelectionHeight.current = next.height;
      setEditHeight(next.height);
      setSelection(next);
    },
    [setSelection],
  );

  const beginRegionDrag = useCallback(
    (handle: ResizeHandle | "move", event: React.MouseEvent) => {
      const image = fullImageRef.current;
      const canvas = shotRef.current;
      if (!image || !canvas || !selection) return;
      const { sx, sy } = selectionToImageCrop(selection, image);

      const baseCanvas = document.createElement("canvas");
      baseCanvas.width = canvas.width;
      baseCanvas.height = canvas.height;
      baseCanvas.getContext("2d")?.drawImage(canvas, 0, 0);

      regionDragRef.current = {
        handle,
        startX: event.clientX,
        startY: event.clientY,
        origin: selection,
        baseCanvas,
        baseSx: sx,
        baseSy: sy,
        baseTextObjects: textObjects,
      };
      // The raster changes size, so previous ImageData snapshots no longer fit.
      history.current = [];
      setCanUndo(false);
      setSelectedTextId(null);
      setAdjustingRegion(true);
    },
    [selection, textObjects],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (textEditor) return;
      if (
        tool === "picker" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.toLowerCase() === "c"
      ) {
        event.preventDefault();
        void copyPickerHex();
        return;
      }
      if (event.key === "Escape") {
        if (tool === "picker") {
          setTool(null);
          setPickerSample(null);
          return;
        }
        if (selectedTextId || selectedNumberId) {
          setSelectedTextId(null);
          setSelectedNumberId(null);
          return;
        }
        cancelOverlay();
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        (selectedTextId || selectedNumberId) &&
        phase === "editing"
      ) {
        event.preventDefault();
        if (selectedTextId) {
          setTextObjects((prev) => prev.filter((item) => item.id !== selectedTextId));
          setSelectedTextId(null);
        }
        if (selectedNumberId) {
          setNumberObjects((previous) => previous.filter((item) => item.id !== selectedNumberId));
          setSelectedNumberId(null);
        }
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "z" &&
        phase === "editing"
      ) {
        event.preventDefault();
        undo();
      }
      if (event.key === "Enter" && phase === "editing" && shotReady && !busy) {
        event.preventDefault();
        void (async () => {
          setBusy(true);
          try {
            await window.api.copyImage(await exportPng());
          } finally {
            setBusy(false);
          }
        })();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    phase,
    busy,
    shotReady,
    undo,
    exportPng,
    cancelOverlay,
    textEditor,
    selectedTextId,
    selectedNumberId,
    tool,
    copyPickerHex,
  ]);

  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      const canvas = shotRef.current;
      if (!canvas || !selection) return;
      const scale = canvas.width / Math.max(1, selection.width);

      const regionDrag = regionDragRef.current;
      if (regionDrag) {
        const dx = event.clientX - regionDrag.startX;
        const dy = event.clientY - regionDrag.startY;
        recropSelection(
          regionDrag.handle === "move"
            ? moveRect(regionDrag.origin, dx, dy)
            : resizeRect(regionDrag.origin, regionDrag.handle, dx, dy),
        );
        return;
      }

      const textDrag = textDragRef.current;
      if (textDrag) {
        const dx = (event.clientX - textDrag.startX) * scale;
        const dy = (event.clientY - textDrag.startY) * scale;
        setTextObjects((prev) =>
          prev.map((item) =>
            item.id === textDrag.id
              ? {
                  ...item,
                  canvasX: Math.max(0, textDrag.originCanvasX + dx),
                  canvasY: Math.max(0, textDrag.originCanvasY + dy),
                }
              : item,
          ),
        );
      }
      const editorDrag = textEditorDragRef.current;
      if (editorDrag) {
        const dx = (event.clientX - editorDrag.startX) * scale;
        const dy = (event.clientY - editorDrag.startY) * scale;
        setTextEditor((current) =>
          current
            ? {
                ...current,
                canvasX: Math.max(0, editorDrag.originCanvasX + dx),
                canvasY: Math.max(0, editorDrag.originCanvasY + dy),
              }
            : current,
        );
      }
      const numberDrag = numberDragRef.current;
      if (numberDrag) {
        const dx = (event.clientX - numberDrag.startX) * scale;
        const dy = (event.clientY - numberDrag.startY) * scale;
        setNumberObjects((previous) =>
          previous.map((item) =>
            item.id === numberDrag.id
              ? {
                  ...item,
                  canvasX: Math.max(0, numberDrag.originCanvasX + dx),
                  canvasY: Math.max(0, numberDrag.originCanvasY + dy),
                }
              : item,
          ),
        );
      }
    };
    const onUp = (): void => {
      textDragRef.current = null;
      textEditorDragRef.current = null;
      numberDragRef.current = null;
      if (regionDragRef.current) {
        regionDragRef.current = null;
        setAdjustingRegion(false);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [selection, recropSelection]);

  const onBgMouseDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (phase !== "selecting" || busy) return;
      setDragging(true);
      const point = clampPoint(event.clientX, event.clientY);
      origin.current = point;
      setSelection({ x: point.x, y: point.y, width: 0, height: 0 });
    },
    [phase, busy, setSelection],
  );

  const onBgMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!dragging || phase !== "selecting") return;
      const point = clampPoint(event.clientX, event.clientY);
      setSelection(
        clampSelection(normalizeRect(origin.current.x, origin.current.y, point.x, point.y)),
      );
    },
    [dragging, phase, setSelection],
  );

  const onBgMouseUp = useCallback(() => {
    if (!dragging || phase !== "selecting") return;
    setDragging(false);
    const current = useStore.getState().selection;
    if (current && current.width >= MIN_SIZE && current.height >= MIN_SIZE) {
      enterEditMode(clampSelection(current));
    } else {
      setSelection(null);
    }
  }, [dragging, phase, enterEditMode, setSelection]);

  const toLocal = (event: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = shotRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) * canvas.width) / Math.max(1, bounds.width),
      y: ((event.clientY - bounds.top) * canvas.height) / Math.max(1, bounds.height),
    };
  };

  const samplePickerColor = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>): PickerSample | null => {
      const image = fullImageRef.current;
      const canvas = shotRef.current;
      if (!image || !canvas || !selection) return null;
      const crop = selectionToImageCrop(selection, image);
      const point = toLocal(event);
      const imageX = Math.max(
        0,
        Math.min(image.naturalWidth - 1, Math.floor(crop.sx + (point.x / canvas.width) * crop.sw)),
      );
      const imageY = Math.max(
        0,
        Math.min(
          image.naturalHeight - 1,
          Math.floor(crop.sy + (point.y / canvas.height) * crop.sh),
        ),
      );
      const sampler = colorSampleCanvas.current ?? document.createElement("canvas");
      sampler.width = 1;
      sampler.height = 1;
      colorSampleCanvas.current = sampler;
      const context = sampler.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.clearRect(0, 0, 1, 1);
      context.drawImage(image, imageX, imageY, 1, 1, 0, 0, 1, 1);
      const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
      const sample = {
        hex: [red, green, blue]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase(),
        red,
        green,
        blue,
        imageX,
        imageY,
        left: Math.min(window.innerWidth - 124, event.clientX + 18),
        top: Math.min(window.innerHeight - 92, event.clientY + 18),
      };
      setPickerSample(sample);
      return sample;
    },
    [selection],
  );

  const onShotMouseDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (phase !== "editing" || busy || !shotReady) return;
      if (textEditor) {
        commitText(textDraft);
        return;
      }
      setSelectedTextId(null);
      setSelectedNumberId(null);
      if (!tool) {
        if (canAdjustRegion) {
          event.preventDefault();
          beginRegionDrag("move", event);
        }
        return;
      }
      if (tool === "picker") {
        const sample = samplePickerColor(event);
        if (sample) {
          setStrokeColor(`#${sample.hex}`);
        }
        return;
      }
      const canvas = shotRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const point = toLocal(event);
      const scale = canvas.width / Math.max(1, selection?.width || canvas.width);

      if (tool === "text") {
        setSelectedTextId(null);
        setTextEditor({
          canvasX: point.x,
          canvasY: point.y,
          left: event.clientX,
          top: event.clientY,
          scale,
          width: 260,
          height: 96,
          ...textStyle,
        });
        setTextDraft("");
        return;
      }

      if (tool === "number") {
        const value = nextNumber.current++;
        setNumberObjects((previous) => [
          ...previous,
          {
            id: `number-${Date.now()}-${value}`,
            value,
            canvasX: point.x,
            canvasY: point.y,
            style: numberStyle,
          },
        ]);
        return;
      }

      drawOrigin.current = point;
      pushHistory();

      if (tool === "pen") {
        penDrawing.current = true;
        setDrawing(true);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = penWidth * scale;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        return;
      }

      if (tool === "highlight") {
        highlightDrawing.current = true;
        highlightPoints.current = [point];
        setDrawing(true);
        return;
      }

      setDrawing(true);
    },
    [
      phase,
      busy,
      tool,
      shotReady,
      pushHistory,
      selection,
      strokeColor,
      textStyle,
      numberStyle,
      penWidth,
      canAdjustRegion,
      beginRegionDrag,
      samplePickerColor,
      textEditor,
      textDraft,
      commitText,
    ],
  );

  const onShotMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (phase === "editing" && tool === "picker") {
        samplePickerColor(event);
        return;
      }
      if (!drawing || phase !== "editing" || !tool) return;
      const canvas = shotRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const point = toLocal(event);
      const scale = canvas.width / Math.max(1, selection?.width || canvas.width);

      if (tool === "pen" && penDrawing.current) {
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
        return;
      }

      if (tool === "highlight" && highlightDrawing.current) {
        highlightPoints.current.push(point);
        const last = history.current[history.current.length - 1];
        if (!last) return;
        ctx.putImageData(last, 0, 0);
        strokeHighlightPath(
          ctx,
          highlightPoints.current,
          strokeColor,
          highlightWidth * scale,
          highlightOpacity,
        );
        return;
      }

      const last = history.current[history.current.length - 1];
      if (!last) return;
      ctx.putImageData(last, 0, 0);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = strokeColor;
      ctx.fillStyle = strokeColor;
      ctx.lineWidth = strokeWidth * scale;
      const { x: x1, y: y1 } = drawOrigin.current;
      const w = point.x - x1;
      const h = point.y - y1;

      if (tool === "rect") {
        if (fillOpacity) {
          ctx.fillStyle = hexToRgba(strokeColor, fillOpacity);
          ctx.fillRect(x1, y1, w, h);
          ctx.fillStyle = strokeColor;
        }
        ctx.strokeRect(x1, y1, w, h);
      } else if (tool === "ellipse") {
        ctx.beginPath();
        ctx.ellipse(x1 + w / 2, y1 + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
        if (fillOpacity) {
          ctx.fillStyle = hexToRgba(strokeColor, fillOpacity);
          ctx.fill();
          ctx.fillStyle = strokeColor;
        }
        ctx.stroke();
      } else if (tool === "arrow")
        drawArrow(ctx, x1, y1, point.x, point.y, arrowStyle, arrowHeadSize);
      else if (tool === "mosaic") {
        applyMosaic(
          ctx,
          Math.min(x1, point.x),
          Math.min(y1, point.y),
          Math.abs(w),
          Math.abs(h),
          Math.max(4, Math.round(mosaicBlock * scale)),
        );
      }
    },
    [
      drawing,
      phase,
      tool,
      selection,
      strokeColor,
      samplePickerColor,
      arrowStyle,
      arrowHeadSize,
      strokeWidth,
      fillOpacity,
      highlightWidth,
      highlightOpacity,
      mosaicBlock,
    ],
  );

  const onShotMouseUp = useCallback(() => {
    if (!drawing) return;
    const canvas = shotRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx) ctx.globalAlpha = 1;
    setDrawing(false);
    penDrawing.current = false;
    highlightDrawing.current = false;
    highlightPoints.current = [];
  }, [drawing]);

  const handleScrollCapture = (): void => {
    // Keep this guard in addition to disabling the toolbar button so a queued or
    // programmatic click cannot start stitching after an annotation was added.
    if (!selection || !shotReady || hasAnnotations || scrollCapturing.current) return;
    void (async () => {
      setBusy(true);
      scrollCapturing.current = true;
      scrollResultReceived.current = false;
      try {
        await window.api.beginScrollCapture(selection);
      } catch (err) {
        scrollCapturing.current = false;
        if (err instanceof Error) setError(err.message);
        setBusy(false);
      }
    })();
  };

  const shotViewportHeight = isLongImage
    ? Math.min(displayHeight, window.innerHeight - selection!.y - 64)
    : displayHeight;

  const toolbarPos = (() => {
    if (!selection || phase !== "editing") return undefined;
    const left = Math.min(
      Math.max(8, selection.x + selection.width / 2 - TOOLBAR_WIDTH / 2),
      window.innerWidth - TOOLBAR_WIDTH - 8,
    );
    if (isLongImage) {
      return { left, top: window.innerHeight - 92 };
    }
    const below = selection.y + displayHeight + 12;
    const top = below + 92 > window.innerHeight ? Math.max(8, selection.y - 100) : below;
    return { left, top };
  })();

  // Tools usable as soon as crop is on canvas — only lock while an action is running
  const toolsLocked = busy || !shotReady;
  const toolSettings: ToolSettings = {
    strokeColor,
    strokeWidth,
    fillOpacity,
    arrowStyle,
    arrowHeadSize,
    penWidth,
    highlightWidth,
    highlightOpacity,
    mosaicBlock,
    pickerFormat,
    textStyle,
    numberStyle,
  };
  const updateToolSettings = (changes: Partial<ToolSettings>): void => {
    if (changes.strokeColor !== undefined) setStrokeColor(changes.strokeColor);
    if (changes.strokeWidth !== undefined) setStrokeWidth(changes.strokeWidth);
    if (changes.fillOpacity !== undefined) setFillOpacity(changes.fillOpacity);
    if (changes.arrowStyle !== undefined) setArrowStyle(changes.arrowStyle);
    if (changes.arrowHeadSize !== undefined) setArrowHeadSize(changes.arrowHeadSize);
    if (changes.penWidth !== undefined) setPenWidth(changes.penWidth);
    if (changes.highlightWidth !== undefined) setHighlightWidth(changes.highlightWidth);
    if (changes.highlightOpacity !== undefined) setHighlightOpacity(changes.highlightOpacity);
    if (changes.mosaicBlock !== undefined) setMosaicBlock(changes.mosaicBlock);
    if (changes.numberStyle !== undefined) setNumberStyle(changes.numberStyle);
    if (changes.textStyle !== undefined) {
      setTextStyle(changes.textStyle);
      lastTextFontSize.current = changes.textStyle.fontSize;
      setTextEditor((current) => (current ? { ...current, ...changes.textStyle } : current));
    }
    if (changes.pickerFormat !== undefined) {
      setPickerFormat(changes.pickerFormat);
      void window.api
        .getScreenshotConfig()
        .then((config) =>
          window.api.updateScreenshotConfig({
            ...config,
            color_copy_format: changes.pickerFormat!,
          }),
        )
        .catch(() => undefined);
    }
  };

  return (
    <div className="screenshot-overlay">
      <canvas
        ref={bgRef}
        className="screenshot-canvas"
        style={{ pointerEvents: phase === "selecting" ? "auto" : "none" }}
        onMouseDown={onBgMouseDown}
        onMouseMove={onBgMouseMove}
        onMouseUp={onBgMouseUp}
        onMouseLeave={onBgMouseUp}
      />

      {phase === "editing" && selection && (
        <div
          ref={shotViewportRef}
          className={`shot-viewport${isLongImage ? " shot-viewport--scrollable" : ""}`}
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: shotViewportHeight,
          }}
          onScroll={(event) => {
            const top = event.currentTarget.scrollTop;
            setViewScrollTop(top);
            paintBackground(selection, displayHeight, top);
          }}
        >
          <canvas
            ref={shotRef}
            className={`shot-canvas${canAdjustRegion ? " shot-canvas--movable" : ""}${tool === "picker" ? " shot-canvas--picker" : ""}`}
            style={{
              width: selection.width,
              height: displayHeight,
            }}
            onMouseDown={onShotMouseDown}
            onMouseMove={onShotMouseMove}
            onMouseUp={onShotMouseUp}
            onMouseLeave={onShotMouseUp}
          />
          {textObjects.map((obj) => {
            if (textEditor?.id === obj.id) return null;
            const canvas = shotRef.current;
            const scaleX = canvas ? canvas.width / Math.max(1, selection.width) : 1;
            const scaleY = canvas ? canvas.height / Math.max(1, displayHeight) : scaleX;
            return (
              <div
                key={obj.id}
                className={`text-object${selectedTextId === obj.id ? " is-selected" : ""}`}
                style={{
                  left: obj.canvasX / scaleX,
                  top: obj.canvasY / scaleY,
                  width: obj.width / scaleX,
                  minHeight: obj.height / scaleY,
                  color: obj.color,
                  fontSize: obj.fontSize,
                  fontFamily: fontFamily(obj.font),
                  fontWeight: obj.bold ? 700 : 400,
                  WebkitTextStroke: obj.strokeWidth
                    ? `${obj.strokeWidth}px ${obj.strokeColor}`
                    : undefined,
                  backgroundColor: hexToRgba(obj.backgroundColor, obj.backgroundOpacity),
                  lineHeight: 1.25,
                  whiteSpace: "pre-wrap",
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setSelectedTextId(obj.id);
                  textDragRef.current = {
                    id: obj.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    originCanvasX: obj.canvasX,
                    originCanvasY: obj.canvasY,
                  };
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openTextObjectEditor(obj);
                }}
              >
                {obj.text}
              </div>
            );
          })}
          {numberObjects.map((item) => {
            const canvas = shotRef.current;
            const scale = canvas ? canvas.width / Math.max(1, selection.width) : 1;
            return (
              <div
                key={item.id}
                className={`number-object${selectedNumberId === item.id ? " is-selected" : ""}`}
                style={{
                  left: item.canvasX / scale,
                  top: item.canvasY / scale,
                  width: item.style.size,
                  height: item.style.size,
                  backgroundColor: item.style.backgroundColor,
                  color: item.style.textColor,
                  fontSize: Math.round(item.style.size * 0.56),
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setSelectedNumberId(item.id);
                  numberDragRef.current = {
                    id: item.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    originCanvasX: item.canvasX,
                    originCanvasY: item.canvasY,
                  };
                }}
              >
                {item.value}
              </div>
            );
          })}
          {textEditor &&
            (() => {
              const canvas = shotRef.current;
              const scale = canvas ? canvas.width / Math.max(1, selection.width) : 1;
              return (
                <div
                  className="inline-text-editor"
                  style={{
                    left: textEditor.canvasX / scale,
                    top: textEditor.canvasY / scale,
                    width: textEditor.width / scale,
                    minHeight: textEditor.height / scale,
                    backgroundColor: hexToRgba(
                      textEditor.backgroundColor,
                      textEditor.backgroundOpacity,
                    ),
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div
                    className="inline-text-editor__move"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      textEditorDragRef.current = {
                        startX: event.clientX,
                        startY: event.clientY,
                        originCanvasX: textEditor.canvasX,
                        originCanvasY: textEditor.canvasY,
                      };
                    }}
                  />
                  <textarea
                    autoFocus
                    value={textDraft}
                    placeholder="输入文字"
                    style={{
                      color: textEditor.color,
                      fontFamily: fontFamily(textEditor.font),
                      fontSize: textEditor.fontSize,
                      fontWeight: textEditor.bold ? 700 : 400,
                      WebkitTextStroke: textEditor.strokeWidth
                        ? `${textEditor.strokeWidth}px ${textEditor.strokeColor}`
                        : undefined,
                    }}
                    onChange={(event) => setTextDraft(event.target.value)}
                    onMouseUp={(event) => {
                      const rect = event.currentTarget.parentElement?.getBoundingClientRect();
                      if (rect)
                        setTextEditor((current) =>
                          current
                            ? {
                                ...current,
                                width: rect.width * scale,
                                height: Math.max(current.height, rect.height * scale),
                              }
                            : current,
                        );
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelTextEditor();
                      }
                      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault();
                        commitText(textDraft);
                      }
                    }}
                  />
                </div>
              );
            })()}
        </div>
      )}

      {canAdjustRegion &&
        selection &&
        RESIZE_HANDLES.map((handle) => {
          const left = handle.includes("w")
            ? selection.x
            : handle.includes("e")
              ? selection.x + selection.width
              : selection.x + selection.width / 2;
          const top = handle.includes("n")
            ? selection.y
            : handle.includes("s")
              ? selection.y + displayHeight
              : selection.y + displayHeight / 2;
          return (
            <div
              key={handle}
              className="selection-handle"
              style={{ left, top, cursor: HANDLE_CURSORS[handle] }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                beginRegionDrag(handle, event);
              }}
            />
          );
        })}

      {canAdjustRegion && selection && !adjustingRegion && (
        <div className="overlay-hint-bar">{t.hints.adjustRegion}</div>
      )}

      {adjustingRegion && selection && (
        <div
          className="selection-size"
          style={{ left: selection.x, top: Math.max(8, selection.y - 28) }}
        >
          {Math.round(selection.width)} × {Math.round(selection.height)}
        </div>
      )}

      {phase === "editing" && !textEditor && textObjects.length > 0 && (
        <div className="long-image-scroll-hint">{t.textEditor.moveHint}</div>
      )}

      {phase === "editing" && isLongImage && (
        <div className="long-image-scroll-hint">{t.scrollCapture.scrollPreviewHint}</div>
      )}

      {phase === "loading" && <div className="overlay-status">{t.hints.capturing}</div>}

      {phase === "selecting" && !selection && !error && (
        <div className="overlay-hint-bar">{t.hints.dragToSelect}</div>
      )}

      {error && <div className="overlay-hint-bar overlay-hint-bar--error">{error}</div>}

      {phase === "editing" && (ocrRunning || ocrPanel.result || ocrPanel.error) && (
        <div className="ocr-result-panel" onMouseDown={(event) => event.stopPropagation()}>
          <div className="ocr-result-panel__header">
            <strong>{t.ocr.title}</strong>
            <span>
              {ocrPanel.result?.engine === "rusto" ? t.ocr.rustoEngine : t.ocr.onnxEngine}
            </span>
            <button
              type="button"
              onClick={() => {
                ocrRequest.current += 1;
                setOcrRunning(false);
                setOcrPanel(EMPTY_OCR);
              }}
            >
              {t.ocr.close}
            </button>
          </div>
          <section className="ocr-result-panel__engine">
            <div className="ocr-result-panel__actions">
              {ocrPanel.elapsedMs !== null && (
                <span className="ocr-result-panel__elapsed">
                  {t.ocr.completedIn(ocrPanel.elapsedMs)}
                </span>
              )}
              <button
                type="button"
                disabled={!ocrPanel.result}
                onClick={() => ocrPanel.result && void window.api.copyText(ocrPanel.result.text)}
              >
                {t.ocr.copy}
              </button>
            </div>
            <textarea
              className="ocr-result-panel__text"
              aria-label={t.ocr.title}
              readOnly
              value={ocrPanel.result?.text ?? ""}
              placeholder={
                ocrPanel.pending ? t.ocr.recognizing : (ocrPanel.error ?? t.ocr.noTextFound)
              }
            />
            {ocrPanel.error && <p className="ocr-result-panel__hint">{ocrPanel.error}</p>}
          </section>
        </div>
      )}

      {phase === "editing" && qrContents && (
        <div className="ocr-result-panel" onMouseDown={(event) => event.stopPropagation()}>
          <div className="ocr-result-panel__header">
            <strong>二维码识别</strong>
            <button type="button" onClick={() => setQrContents(null)}>
              {t.ocr.close}
            </button>
          </div>
          {qrContents.length === 0 ? (
            <p className="ocr-result-panel__hint">未在选区中发现二维码。</p>
          ) : (
            qrContents.map((content) => (
              <div key={content} className="ocr-result-panel__actions">
                <code>{content}</code>
                <button type="button" onClick={() => void window.api.copyText(content)}>
                  复制
                </button>
                {/^https?:\/\//i.test(content) && (
                  <button type="button" onClick={() => void window.api.openUrl(content)}>
                    打开链接
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {selection && selection.width > 0 && selection.height > 0 && phase === "selecting" && (
        <div
          className="selection-size"
          style={{ left: selection.x, top: Math.max(8, selection.y - 28) }}
        >
          {Math.round(selection.width)} × {Math.round(selection.height)}
        </div>
      )}

      {phase === "editing" && tool === "picker" && pickerSample && fullImageRef.current && (
        <div className="picker-preview" style={{ left: pickerSample.left, top: pickerSample.top }}>
          <div
            className="picker-preview__zoom"
            style={{
              backgroundImage: `url(${fullImageRef.current.src})`,
              backgroundSize: `${fullImageRef.current.naturalWidth * 10}px ${fullImageRef.current.naturalHeight * 10}px`,
              backgroundPosition: `${70 - pickerSample.imageX * 10}px ${70 - pickerSample.imageY * 10}px`,
            }}
          >
            <span />
          </div>
          <div className="picker-preview__meta">
            <i style={{ backgroundColor: `#${pickerSample.hex}` }} />
            <span>
              {pickerCopied ? "已复制" : `#${pickerSample.hex}`}
              <small>{`RGB ${pickerSample.red}, ${pickerSample.green}, ${pickerSample.blue}`}</small>
            </span>
          </div>
        </div>
      )}

      {phase === "editing" && toolbarPos && (
        <>
          <AnnotationToolbar
            tool={tool}
            canUndo={canUndo}
            toolsDisabled={toolsLocked}
            scrollCaptureDisabled={hasAnnotations}
            confirmDisabled={toolsLocked}
            ocrDisabled={!selection || !shotReady || ocrRunning}
            ocrRunning={ocrRunning}
            pickerColor={pickerSample ? `#${pickerSample.hex}` : undefined}
            options={
              tool ? (
                <ToolOptionsBar tool={tool} settings={toolSettings} onChange={updateToolSettings} />
              ) : undefined
            }
            style={toolbarPos}
            onToolChange={(next) => {
              if (textEditor) commitText(textDraft);
              setTool(next);
              if (next !== "picker") setPickerSample(null);
              if (next !== "number") nextNumber.current = 1;
            }}
            onUndo={undo}
            onScrollCapture={handleScrollCapture}
            onSave={() => {
              void (async () => {
                setBusy(true);
                try {
                  await window.api.saveImage(await exportPng());
                } finally {
                  setBusy(false);
                }
              })();
            }}
            onPin={() => {
              void (async () => {
                const action = ++pendingAction.current;
                setBusy(true);
                try {
                  const png = await exportPng();
                  if (action !== pendingAction.current) return;
                  await window.api.pinImage(png);
                } catch (err) {
                  if (action === pendingAction.current) {
                    setError(err instanceof Error ? err.message : "Failed to pin screenshot");
                  }
                } finally {
                  if (action === pendingAction.current) setBusy(false);
                }
              })();
            }}
            onOcr={recognizeSelection}
            onQr={() => {
              if (!selection || !shotReady || ocrRunning) return;
              void (async () => {
                try {
                  const result = await window.api.decodeQrSelection(await exportOcrPng());
                  setQrContents(result.contents);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "二维码识别失败");
                }
              })();
            }}
            onCancel={cancelOverlay}
            onConfirm={() => {
              void (async () => {
                setBusy(true);
                try {
                  await window.api.copyImage(await exportPng());
                } finally {
                  setBusy(false);
                }
              })();
            }}
          />
        </>
      )}

      {busy && <div className="overlay-status">{t.hints.working}</div>}
    </div>
  );
}

export default ScreenshotOverlay;
