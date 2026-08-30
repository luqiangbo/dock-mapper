import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { OcrTextBlock, WindowCandidate } from "../api";
import { useI18n } from "../i18n";
import type { ColorPaletteConfig, ScreenshotConfig } from "../../../types";
import { paletteApi } from "../../../api/commands";
import AnnotationToolbar, { STROKE_COLORS, type AnnotTool } from "./AnnotationToolbar";
import { loadImageFromUrl } from "../utils/imageLoad";
import {
  fontFamily,
  TEXT_SIZES,
  type TextEditorState,
  type TextObject,
  type TextSize,
} from "./textTypes";
import ToolOptionsBar from "./ToolOptionsBar";
import { useOcr } from "../hooks/useOcr";
import { RequestGeneration } from "../hooks/requestGeneration";
import { useCaptureLifecycle, type Selection } from "../hooks/useCaptureLifecycle";
import { useEditorSceneState } from "../hooks/useEditorSceneState";
import { useOverlayKeyboard } from "../hooks/useOverlayKeyboard";
import { ObjectMutationTransaction, useEditorHistory } from "../hooks/useCanvasHistory";
import {
  calculateSelectionCrop,
  HANDLE_CURSORS,
  mapCropPoint,
  moveRect,
  RESIZE_HANDLES,
  resizeRect,
  type SelectionCrop,
  type ResizeHandle,
} from "./selectionGeometry";
import SelectionSizePanel, { SELECTION_SIZE_PANEL_SIZE, type AspectPreset } from "./SelectionSizePanel";
import {
  calculateSelectionSizePanelPosition,
  fitSelectionToAspectRatio,
  getSelectionSize,
  getSelectionSizeLimits,
  normalizeAspectRatio,
  resizeSelectionToSize,
  resizeSelectionWithAspectRatio,
  selectWithAspectRatio,
  type AspectRatio,
  type CaptureSizeUnit,
  type OutputSize,
} from "./selectionSizeGeometry";
import {
  DEFAULT_NUMBER_STYLE,
  DEFAULT_TEXT_STYLE,
  type ArrowStyle,
  type TextStyle,
  type ToolSettings,
} from "./annotationTypes";
import { calculateToolbarLayout, shouldCompactToolbar, type ToolbarSize } from "./toolbarLayout";
import {
  appendGesturePoint,
  createAnnotationGesture,
  resolveAnnotationGesture,
  shouldHandlePointer,
  type AnnotationGesture,
  type RasterTool,
} from "./annotationGesture";
import { resizeTextBox, TEXT_RESIZE_HANDLES, type TextResizeHandle } from "./textTransform";
import { NativeInputGate, type NativeInputOwner } from "./nativeInputGate";
import { isTextObjectInteractive, wrapTextLines } from "./textLayout";
import { calculatePickerPosition } from "./pickerGeometry";
import { useCommittedImageAction } from "../hooks/useCommittedImageAction";
import {
  annotationBounds,
  cloneRasterAnnotations,
  renderRasterOverlay,
  renderRasterScene,
  resizeAnnotation,
  simplifyScenePoints,
  translateAnnotation,
  type RasterAnnotation,
  type SceneBounds,
} from "./annotationScene";
import {
  appendNumberObject,
  clampNumberCenter,
  isNumberObjectInteractive,
  type NumberObject,
} from "./numberObjects";
import { findWindowCandidate } from "./windowCandidates";

const MIN_SIZE = 8;
const EMPTY_TOOLBAR_SIZE: ToolbarSize = { width: 0, height: 0 };
let lastConfirmedSelection: Selection | null = null;

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

interface RasterGestureSettings {
  strokeColor: string;
  strokeWidth: number;
  fillOpacity: number;
  arrowStyle: ArrowStyle;
  arrowHeadSize: number;
  penWidth: number;
  highlightWidth: number;
  highlightOpacity: number;
  mosaicBlock: number;
}

type ActiveAnnotationGesture = AnnotationGesture<RasterAnnotation[]> & {
  id: string;
  settings: RasterGestureSettings;
};
interface NativeCanvasPoint {
  clientX: number;
  clientY: number;
}
interface NativeCanvasHandlers {
  begin: (
    owner: NativeInputOwner,
    event: NativeCanvasPoint & { button: number; preventDefault: () => void },
  ) => boolean;
  move: (owner: NativeInputOwner, event: NativeCanvasPoint) => void;
  finish: (owner: NativeInputOwner) => void;
  cancel: (owner: NativeInputOwner) => void;
  sample: (event: NativeCanvasPoint) => void;
  clearSample: () => void;
}

interface SelectionRecropBaseline {
  // Pixels captured before the region changes, so shrinking then re-growing a
  // selection (or changing it from the size panel) retains annotations.
  baseCrop: SelectionCrop;
  baseTextObjects: TextObject[];
  baseNumberObjects: NumberObject[];
  baseRasterAnnotations: RasterAnnotation[];
}

function rasterFromGesture(gesture: ActiveAnnotationGesture, scale: number): RasterAnnotation {
  const isFreehand = gesture.tool === "pen" || gesture.tool === "highlight";
  const last = gesture.points[gesture.points.length - 1] ?? gesture.start;
  return {
    id: gesture.id,
    kind: gesture.tool,
    points: isFreehand
      ? simplifyScenePoints(gesture.points, Math.max(0.75, scale * 0.35))
      : [{ ...gesture.start }, { ...last }],
    style: {
      color: gesture.settings.strokeColor,
      strokeWidth:
        gesture.tool === "pen"
          ? gesture.settings.penWidth * scale
          : gesture.tool === "highlight"
            ? gesture.settings.highlightWidth * scale
            : gesture.settings.strokeWidth * scale,
      fillOpacity: gesture.settings.fillOpacity,
      arrowStyle: gesture.settings.arrowStyle,
      arrowHeadSize: gesture.settings.arrowHeadSize,
      opacity: gesture.tool === "highlight" ? gesture.settings.highlightOpacity : 1,
      mosaicBlock: Math.max(4, Math.round(gesture.settings.mosaicBlock * scale)),
    },
  };
}

type ColorCopyFormat = ScreenshotConfig["color_copy_format"];

interface ObjectSnapshot {
  rasterAnnotations: RasterAnnotation[];
  textObjects: TextObject[];
  numberObjects: NumberObject[];
}

function cloneObjectSnapshot(snapshot: ObjectSnapshot): ObjectSnapshot {
  return {
    rasterAnnotations: cloneRasterAnnotations(snapshot.rasterAnnotations),
    textObjects: snapshot.textObjects.map((item) => ({ ...item })),
    numberObjects: snapshot.numberObjects.map((item) => ({
      ...item,
      style: { ...item.style },
    })),
  };
}

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

function nearestTextSize(value: number): TextSize {
  return TEXT_SIZES.reduce((nearest, size) =>
    Math.abs(size - value) < Math.abs(nearest - value) ? size : nearest,
  );
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
): SelectionCrop {
  return calculateSelectionCrop(
    rect,
    image.naturalWidth,
    image.naturalHeight,
    window.innerWidth,
    window.innerHeight,
    heightOverride,
  );
}

function ScreenshotOverlay(): React.JSX.Element {
  const { t } = useI18n();
  const bgRef = useRef<HTMLCanvasElement>(null);
  const shotRef = useRef<HTMLCanvasElement>(null);
  const shotBaseRef = useRef<HTMLCanvasElement | null>(null);
  const shotViewportRef = useRef<HTMLDivElement>(null);
  const primaryToolbarRef = useRef<HTMLDivElement>(null);
  const secondaryToolbarRef = useRef<HTMLDivElement>(null);
  const expandedToolbarWidth = useRef(0);
  const openToolbarPopups = useRef(new Set<string>());
  const fullImageRef = useRef<HTMLImageElement | null>(null);
  const colorSampleCanvas = useRef<HTMLCanvasElement | null>(null);
  const pickerZoomRef = useRef<HTMLCanvasElement>(null);
  const origin = useRef({ x: 0, y: 0 });
  const pendingWindowSelection = useRef<Selection | null>(null);
  const backgroundMoveFrame = useRef<number | null>(null);
  const pendingBackgroundPoint = useRef<NativeCanvasPoint | null>(null);
  const draggingRef = useRef(false);
  const annotationGestureRef = useRef<ActiveAnnotationGesture | null>(null);
  const annotationPreviewFrame = useRef<number | null>(null);
  const annotationPreviewScale = useRef(1);
  const pickerSampleFrame = useRef<number | null>(null);
  const pendingPickerPoint = useRef<NativeCanvasPoint | null>(null);
  const nativeInputGateRef = useRef(new NativeInputGate());
  const nativeCanvasHandlersRef = useRef<NativeCanvasHandlers | null>(null);
  const pendingAction = useRef(0);
  const qrRequest = useRef(new RequestGeneration());
  const palettePendingMutations = useRef(0);
  const paletteMutationTail = useRef<Promise<void>>(Promise.resolve());
  const screenshotConfigRef = useRef<ScreenshotConfig | null>(null);
  const screenshotConfigMutationTail = useRef<Promise<void>>(Promise.resolve());
  const screenshotConfigRevision = useRef(0);
  const screenshotConfigPendingMutations = useRef(0);
  // 递增令牌使得选区变化、关闭或新截图后的迟到 OCR 结果立即失效。
  const imageScaleRef = useRef({ scaleX: 1, scaleY: 1 });
  const lastTextFontSize = useRef<TextSize>(TEXT_SIZES[1]);
  const objectMutationRef = useRef(new ObjectMutationTransaction<ObjectSnapshot>());
  const objectStyleChangedRef = useRef(false);
  const textDragRef = useRef<{
    pointerId: number;
    id: string;
    startX: number;
    startY: number;
    originCanvasX: number;
    originCanvasY: number;
    maxCanvasX: number;
    maxCanvasY: number;
    changed: boolean;
  } | null>(null);
  const textResizeRef = useRef<{
    pointerId: number;
    id: string;
    handle: TextResizeHandle;
    origin: TextObject;
    changed: boolean;
  } | null>(null);
  const textEditorDragRef = useRef<{
    startX: number;
    startY: number;
    originCanvasX: number;
    originCanvasY: number;
  } | null>(null);
  const numberDragRef = useRef<{
    pointerId: number;
    id: string;
    startX: number;
    startY: number;
    originCanvasX: number;
    originCanvasY: number;
    radius: number;
    changed: boolean;
  } | null>(null);
  const rasterTransformRef = useRef<{
    pointerId: number;
    id: string;
    mode: "move" | ResizeHandle;
    startX: number;
    startY: number;
    origin: RasterAnnotation;
    originBounds: SceneBounds;
    changed: boolean;
  } | null>(null);
  const regionDragRef = useRef<({
    handle: ResizeHandle | "move";
    startX: number;
    startY: number;
    origin: Selection;
  } & SelectionRecropBaseline) | null>(null);

  const [dragging, setDragging] = useState(false);
  const [windowCandidates, setWindowCandidates] = useState<WindowCandidate[]>([]);
  const [hoveredWindow, setHoveredWindow] = useState<Selection | null>(null);
  const {
    phase,
    busy,
    shotReady,
    error,
    setPhase,
    setBusy,
    setShotReady,
    setError,
    beginCapture,
    captureReady,
    beginEditing,
    beginCommit,
    restoreEditing,
    fail,
    reset,
    selection,
    setSelection,
    selectionRef,
  } = useCaptureLifecycle();
  const {
    tool,
    setTool,
    textEditor,
    setTextEditor,
    textDraft,
    setTextDraft,
    textObjects,
    setTextObjects,
    numberObjects,
    setNumberObjects,
    rasterAnnotations,
    setRasterAnnotations,
    rasterPreview,
    setRasterPreview,
    selectedRasterId,
    setSelectedRasterId,
    selectedTextId,
    setSelectedTextId,
    selectedNumberId,
    setSelectedNumberId,
    resetScene,
  } = useEditorSceneState();
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
  const [adjustingRegion, setAdjustingRegion] = useState(false);
  const [pickerSample, setPickerSample] = useState<PickerSample | null>(null);
  const [palette, setPalette] = useState<ColorPaletteConfig>({ recent: [], favorites: [] });
  const [paletteBusy, setPaletteBusy] = useState(false);
  const [pickerCopied, setPickerCopied] = useState(false);
  const [pickerFormat, setPickerFormat] = useState<ColorCopyFormat>("hex");
  const [captureSizeUnit, setCaptureSizeUnit] = useState<CaptureSizeUnit>("px");
  const [screenshotConfigSaving, setScreenshotConfigSaving] = useState(false);
  const [aspectPreset, setAspectPreset] = useState<AspectPreset>("free");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio | null>(null);
  const [qrContents, setQrContents] = useState<string[] | null>(null);
  const [activeOcrBlock, setActiveOcrBlock] = useState<OcrTextBlock | null>(null);
  const [arrowStyle, setArrowStyle] = useState<ArrowStyle>("filled");
  const [viewportSize, setViewportSize] = useState<ToolbarSize>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [primaryToolbarSize, setPrimaryToolbarSize] = useState<ToolbarSize>(EMPTY_TOOLBAR_SIZE);
  const [secondaryToolbarSize, setSecondaryToolbarSize] = useState<ToolbarSize>(EMPTY_TOOLBAR_SIZE);
  const [compactToolbar, setCompactToolbar] = useState(() => window.innerWidth < 680);
  const [toolbarPopupOpen, setToolbarPopupOpen] = useState(false);

  useEffect(
    () => () => {
      if (backgroundMoveFrame.current !== null) cancelAnimationFrame(backgroundMoveFrame.current);
      if (annotationPreviewFrame.current !== null)
        cancelAnimationFrame(annotationPreviewFrame.current);
      if (pickerSampleFrame.current !== null) cancelAnimationFrame(pickerSampleFrame.current);
      backgroundMoveFrame.current = null;
      annotationPreviewFrame.current = null;
      pickerSampleFrame.current = null;
      pendingBackgroundPoint.current = null;
      pendingPickerPoint.current = null;
    },
    [],
  );

  const objectStateRef = useRef<ObjectSnapshot>({
    rasterAnnotations: [],
    textObjects: [],
    numberObjects: [],
  });
  objectStateRef.current = { rasterAnnotations, textObjects, numberObjects };

  const restoreObjectSnapshot = useCallback((snapshot: ObjectSnapshot) => {
    const restored = cloneObjectSnapshot(snapshot);
    setTextObjects(restored.textObjects);
    setNumberObjects(restored.numberObjects);
    setRasterAnnotations(restored.rasterAnnotations);
    setRasterPreview(null);
  }, []);
  const {
    canUndo,
    canRedo,
    pushObjects,
    undo: undoHistory,
    redo: redoHistory,
    reset: resetHistory,
  } = useEditorHistory(restoreObjectSnapshot);

  const captureObjectSnapshot = useCallback(() => cloneObjectSnapshot(objectStateRef.current), []);
  const beginObjectMutation = useCallback(() => {
    objectMutationRef.current.begin(captureObjectSnapshot());
  }, [captureObjectSnapshot]);
  const commitObjectMutation = useCallback(
    (changed: boolean) => {
      const snapshot = objectMutationRef.current.commit(changed);
      if (snapshot) pushObjects(snapshot);
    },
    [pushObjects],
  );
  const cancelObjectMutation = useCallback(() => objectMutationRef.current.cancel(), []);
  const pushCurrentObjects = useCallback(
    () => pushObjects(captureObjectSnapshot()),
    [captureObjectSnapshot, pushObjects],
  );
  const undo = useCallback(() => {
    cancelObjectMutation();
    const gesture = annotationGestureRef.current;
    if (gesture) setRasterAnnotations(cloneRasterAnnotations(gesture.baseline));
    annotationGestureRef.current = null;
    setRasterPreview(null);
    nativeInputGateRef.current.reset();
    setTextEditor(null);
    setTextDraft("");
    setSelectedTextId(null);
    setSelectedNumberId(null);
    setSelectedRasterId(null);
    undoHistory(captureObjectSnapshot());
  }, [cancelObjectMutation, captureObjectSnapshot, undoHistory]);
  const redo = useCallback(() => {
    cancelObjectMutation();
    annotationGestureRef.current = null;
    setRasterPreview(null);
    nativeInputGateRef.current.reset();
    setTextEditor(null);
    setTextDraft("");
    setSelectedTextId(null);
    setSelectedNumberId(null);
    setSelectedRasterId(null);
    redoHistory(captureObjectSnapshot());
  }, [cancelObjectMutation, captureObjectSnapshot, redoHistory]);

  useEffect(() => {
    qrRequest.current.cancel();
    setQrContents(null);
    setActiveOcrBlock(null);
  }, [selection?.x, selection?.y, selection?.width, selection?.height]);

  useEffect(() => {
    const gesture = annotationGestureRef.current;
    if (gesture) {
      if (annotationPreviewFrame.current !== null) cancelAnimationFrame(annotationPreviewFrame.current);
      annotationPreviewFrame.current = null;
      annotationGestureRef.current = null;
      setRasterPreview(null);
    }
    if (pickerSampleFrame.current !== null) cancelAnimationFrame(pickerSampleFrame.current);
    pickerSampleFrame.current = null;
    pendingPickerPoint.current = null;
    if (tool !== "picker") setPickerSample(null);
    nativeInputGateRef.current.reset();
  }, [tool, selection?.x, selection?.y, selection?.width, selection?.height]);

  const reportToolbarPopup = useCallback((source: string, open: boolean) => {
    if (open) openToolbarPopups.current.add(source);
    else openToolbarPopups.current.delete(source);
    setToolbarPopupOpen(openToolbarPopups.current.size > 0);
  }, []);

  const reportPrimaryPopup = useCallback(
    (open: boolean) => reportToolbarPopup("primary", open),
    [reportToolbarPopup],
  );
  const reportSecondaryPopup = useCallback(
    (open: boolean) => {
      reportToolbarPopup("secondary", open);
      if (open && (selectedTextId || selectedNumberId || selectedRasterId)) {
        objectStyleChangedRef.current = false;
        beginObjectMutation();
      } else if (!open && objectMutationRef.current.active) {
        commitObjectMutation(objectStyleChangedRef.current);
        objectStyleChangedRef.current = false;
      }
    },
    [
      beginObjectMutation,
      commitObjectMutation,
      reportToolbarPopup,
      selectedNumberId,
      selectedRasterId,
      selectedTextId,
    ],
  );

  useEffect(() => {
    if (phase === "editing") return;
    openToolbarPopups.current.clear();
    setToolbarPopupOpen(false);
  }, [phase]);

  useLayoutEffect(() => {
    if (phase !== "editing") {
      setPrimaryToolbarSize(EMPTY_TOOLBAR_SIZE);
      setSecondaryToolbarSize(EMPTY_TOOLBAR_SIZE);
      return;
    }

    const measure = (): void => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setViewportSize({ width, height });

      const primary = primaryToolbarRef.current;
      if (primary) {
        const rect = primary.getBoundingClientRect();
        const measured = { width: rect.width, height: rect.height };
        setPrimaryToolbarSize(measured);
        if (!compactToolbar) {
          expandedToolbarWidth.current = Math.max(rect.width, primary.scrollWidth);
        }
        const expandedWidth = expandedToolbarWidth.current;
        const nextCompact = shouldCompactToolbar(width, expandedWidth || rect.width);
        if (nextCompact !== compactToolbar) setCompactToolbar(nextCompact);
      }

      const secondary = secondaryToolbarRef.current;
      if (secondary) {
        const rect = secondary.getBoundingClientRect();
        setSecondaryToolbarSize({ width: rect.width, height: rect.height });
      } else {
        setSecondaryToolbarSize(EMPTY_TOOLBAR_SIZE);
      }
    };

    const observer = new ResizeObserver(measure);
    if (primaryToolbarRef.current) observer.observe(primaryToolbarRef.current);
    if (secondaryToolbarRef.current) observer.observe(secondaryToolbarRef.current);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [compactToolbar, phase, tool]);

  const loadPalette = useCallback(async (): Promise<void> => {
    try {
      await paletteMutationTail.current;
      setPalette(await paletteApi.get());
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(`颜色列表读取失败：${message}`);
    }
  }, [setError]);

  const mutatePalette = useCallback(
    async (
      operation: () => Promise<ColorPaletteConfig>,
      failureMessage: string,
    ): Promise<boolean> => {
      palettePendingMutations.current += 1;
      setPaletteBusy(true);

      const mutation = paletteMutationTail.current.then(operation, operation);
      paletteMutationTail.current = mutation.then(
        () => undefined,
        () => undefined,
      );

      try {
        setPalette(await mutation);
        return true;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const detail = `${failureMessage}：${message}`;
        setError(detail);
        return false;
      } finally {
        palettePendingMutations.current -= 1;
        if (palettePendingMutations.current === 0) setPaletteBusy(false);
      }
    },
    [setError],
  );

  const updateScreenshotConfig = useCallback(
    async (changes: Partial<ScreenshotConfig>, failureMessage: string): Promise<boolean> => {
      const revision = ++screenshotConfigRevision.current;
      screenshotConfigPendingMutations.current += 1;
      setScreenshotConfigSaving(true);
      const mutation = screenshotConfigMutationTail.current.then(async () => {
        const current = screenshotConfigRef.current ?? await window.api.getScreenshotConfig();
        const next = await window.api.updateScreenshotConfig({ ...current, ...changes });
        screenshotConfigRef.current = next;
        if (revision === screenshotConfigRevision.current) {
          setPickerFormat(next.color_copy_format);
          setCaptureSizeUnit(next.capture_size_unit);
        }
      });
      screenshotConfigMutationTail.current = mutation.then(() => undefined, () => undefined);
      try {
        await mutation;
        return true;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(`${failureMessage}：${message}`);
        return false;
      } finally {
        screenshotConfigPendingMutations.current -= 1;
        if (screenshotConfigPendingMutations.current === 0) setScreenshotConfigSaving(false);
      }
    },
    [setError],
  );

  useEffect(() => {
    const revision = screenshotConfigRevision.current;
    void window.api
      .getScreenshotConfig()
      .then((config) => {
        if (revision !== screenshotConfigRevision.current) return;
        screenshotConfigRef.current = config;
        setPickerFormat(config.color_copy_format);
        setCaptureSizeUnit(config.capture_size_unit);
      })
      .catch((cause) => {
        setError(`截图配置读取失败：${cause instanceof Error ? cause.message : String(cause)}`);
      });
    void loadPalette();
  }, [loadPalette, setError]);

  useEffect(() => {
    if (phase === "capturing") {
      setAspectPreset("free");
      setAspectRatio(null);
    }
  }, [phase]);

  const copyPickerSample = useCallback(async (sample: PickerSample) => {
    try {
      const copied = await window.api.copyText(formatPickerColor(sample, pickerFormat));
      if (!copied) throw new Error("剪贴板未接受颜色文本");
      setPickerCopied(true);
      window.setTimeout(() => setPickerCopied(false), 900);
    } catch (cause) {
      setError(`颜色复制失败：${cause instanceof Error ? cause.message : String(cause)}`);
      return;
    }
    await mutatePalette(() => paletteApi.record(`#${sample.hex}`), "最近颜色保存失败");
  }, [mutatePalette, pickerFormat, setError]);

  const copyPickerHex = useCallback(async () => {
    if (!pickerSample) return;
    try {
      const copied = await window.api.copyText(pickerSample.hex);
      if (!copied) throw new Error("剪贴板未接受颜色文本");
      setPickerCopied(true);
      window.setTimeout(() => setPickerCopied(false), 900);
    } catch (cause) {
      setError(`颜色复制失败：${cause instanceof Error ? cause.message : String(cause)}`);
      return;
    }
    await mutatePalette(() => paletteApi.record(`#${pickerSample.hex}`), "最近颜色保存失败");
  }, [mutatePalette, pickerSample, setError]);

  const copyPaletteColor = useCallback(async (color: string) => {
    try {
      const copied = await window.api.copyText(color);
      if (!copied) throw new Error("剪贴板未接受颜色文本");
    } catch (cause) {
      setError(`颜色复制失败：${cause instanceof Error ? cause.message : String(cause)}`);
      return;
    }
    await mutatePalette(() => paletteApi.record(color), "最近颜色保存失败");
  }, [mutatePalette, setError]);

  const setPaletteFavorite = useCallback(async (color: string, favorite: boolean) => {
    await mutatePalette(
      () => paletteApi.favorite(color, favorite),
      favorite ? "颜色收藏失败" : "取消收藏失败",
    );
  }, [mutatePalette]);

  useLayoutEffect(() => {
    const canvas = pickerZoomRef.current;
    const image = fullImageRef.current;
    if (!canvas || !image || !pickerSample) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const zoom = 8;
    const half = 7;
    const gridOffset = Math.floor((canvas.width - 15 * zoom) / 2);
    const requestedX = pickerSample.imageX - half;
    const requestedY = pickerSample.imageY - half;
    const sourceX = Math.max(0, requestedX);
    const sourceY = Math.max(0, requestedY);
    const sourceWidth = Math.min(15, image.naturalWidth - sourceX);
    const sourceHeight = Math.min(15, image.naturalHeight - sourceY);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#08090d";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      gridOffset + (sourceX - requestedX) * zoom,
      gridOffset + (sourceY - requestedY) * zoom,
      sourceWidth * zoom,
      sourceHeight * zoom,
    );
  }, [pickerSample]);

  const displayHeight = selection?.height ?? 0;
  const canAdjustRegion = phase === "editing" && shotReady && !busy && !tool;
  const textObjectsInteractive = isTextObjectInteractive(tool);
  const selectionSizePanel = (() => {
    const image = fullImageRef.current;
    if (!selection || !image || selection.width <= 0 || selection.height <= 0) return null;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    return {
      size: getSelectionSize(
        selection,
        image.naturalWidth,
        image.naturalHeight,
        viewport.width,
        viewport.height,
        captureSizeUnit,
      ),
      limits: getSelectionSizeLimits(
        selection,
        image.naturalWidth,
        image.naturalHeight,
        viewport.width,
        viewport.height,
        captureSizeUnit,
      ),
      position: calculateSelectionSizePanelPosition(
        selection,
        SELECTION_SIZE_PANEL_SIZE,
        viewport,
      ),
    };
  })();

  const paintBackground = useCallback(
    (rect: Selection | null, holeHeight?: number, _scrollTop = 0, showStroke = true) => {
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
        const crop = selectionToImageCrop(rect, image, visibleHeight);
        ctx.save();
        ctx.beginPath();
        ctx.rect(crop.sourceX, crop.sourceY, crop.sourceWidth, crop.sourceHeight);
        ctx.clip();
        ctx.drawImage(image, 0, 0, width, height);
        ctx.restore();
        if (showStroke) {
          ctx.strokeStyle = "#6366f1";
          ctx.lineWidth = 2;
          ctx.strokeRect(
            crop.sourceX + 1,
            crop.sourceY + 1,
            Math.max(0, crop.sourceWidth - 2),
            Math.max(0, crop.sourceHeight - 2),
          );
        }
      }
    },
    [],
  );

  const exportPng = useCallback(async (): Promise<Uint8Array> => {
    const canvas = shotRef.current;
    if (!canvas) throw new Error("No canvas");

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.imageSmoothingEnabled = false;
    const base = shotBaseRef.current;
    if (!base) throw new Error("Screenshot base is unavailable");
    renderRasterScene(
      ctx,
      base,
      rasterAnnotations,
      canvas.width / Math.max(1, selection?.width ?? canvas.width),
    );
    for (const obj of textObjects) {
      const fontPx = Math.round(obj.fontSize * obj.scale * obj.transformScale);
      const width = Math.max(1, obj.width * obj.transformScale);
      const lineHeight = Math.round(fontPx * 1.25);
      ctx.fillStyle = obj.color;
      ctx.font = `${obj.bold ? "700" : "400"} ${fontPx}px ${fontFamily(obj.font)}`;
      ctx.textBaseline = "top";
      ctx.lineWidth = Math.max(0, obj.strokeWidth * obj.scale * obj.transformScale);
      ctx.strokeStyle = obj.strokeColor;
      const padding = 4 * obj.transformScale;
      const lines = wrapTextLines(
        obj.text,
        width - padding * 2,
        (value) => ctx.measureText(value).width,
      );
      lines.forEach((value, index) => {
        const y = obj.canvasY + padding + index * lineHeight;
        if (ctx.lineWidth) ctx.strokeText(value, obj.canvasX + padding, y);
        ctx.fillText(value, obj.canvasX + padding, y);
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
  }, [rasterAnnotations, textObjects, numberObjects, selection?.width]);

  const exportOcrPng = useCallback(async (): Promise<Uint8Array> => {
    const canvas = shotRef.current;
    const source = document.createElement("canvas");
    const ctx = source.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.imageSmoothingEnabled = false;
    const frozenImage = fullImageRef.current;
    // 始终从冻结原图重新裁切，避免矩形、画笔、文字等标注影响 OCR。
    if (frozenImage && selection) {
      const crop = selectionToImageCrop(selection, frozenImage);
      source.width = crop.outputWidth;
      source.height = crop.outputHeight;
      ctx.drawImage(
        frozenImage,
        crop.sourceX,
        crop.sourceY,
        crop.sourceWidth,
        crop.sourceHeight,
        0,
        0,
        crop.outputWidth,
        crop.outputHeight,
      );
    } else if (canvas) {
      source.width = canvas.width;
      source.height = canvas.height;
      ctx.drawImage(canvas, 0, 0);
    } else {
      throw new Error("No canvas");
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
      source.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("toBlob failed"))),
        "image/png",
      );
    });
    return new Uint8Array(await blob.arrayBuffer());
  }, [selection]);

  const runCommittedImageAction = useCommittedImageAction({
    pendingAction,
    exportPng,
    beginCommit,
    restoreEditing,
    setBusy,
    fail,
  });

  const {
    panel: ocrPanel,
    running: ocrRunning,
    recognize: recognizeSelection,
    dismiss: dismissOcr,
  } = useOcr({
    enabled: Boolean(selection && shotReady),
    exportPng: exportOcrPng,
    engineFailed: t.ocr.engineFailed,
    exportFailed: t.ocr.exportFailed,
    onError: setError,
  });

  useEffect(
    () => dismissOcr(),
    [dismissOcr, selection?.x, selection?.y, selection?.width, selection?.height],
  );

  const cancelOverlay = useCallback(() => {
    // Invalidate an export that is still waiting for canvas encoding before it
    // reaches the native pin/save/copy command.
    pendingAction.current += 1;
    const gesture = annotationGestureRef.current;
    if (gesture) setRasterAnnotations(cloneRasterAnnotations(gesture.baseline));
    annotationGestureRef.current = null;
    setRasterPreview(null);
    nativeInputGateRef.current.reset();
    cancelObjectMutation();
    dismissOcr();
    qrRequest.current.cancel();
    reset();
    window.api.closeOverlay();
  }, [cancelObjectMutation, dismissOcr, reset]);

  const screenToCanvas = useCallback(
    (left: number, top: number): { canvasX: number; canvasY: number } => {
      const canvas = shotRef.current;
      if (!canvas || !selection) return { canvasX: 0, canvasY: 0 };
      const scaleX = canvas.width / Math.max(1, selection.width);
      const scaleY = canvas.height / Math.max(1, selection.height);
      const viewport = shotViewportRef.current;
      const scrollTop = viewport?.scrollTop ?? 0;
      return {
        canvasX: (left - selection.x) * scaleX,
        canvasY: (top - selection.y + scrollTop) * scaleY,
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
          transformScale: textEditor.transformScale,
          width: textEditor.width,
          height: textEditor.height,
          fontSize: textEditor.fontSize,
          color: textEditor.color,
          font: textEditor.font,
          bold: textEditor.bold,
          strokeColor: textEditor.strokeColor,
          strokeWidth: textEditor.strokeWidth,
        };
        const previous = objectStateRef.current.textObjects.find((item) => item.id === next.id);
        if (!previous || JSON.stringify(previous) !== JSON.stringify(next)) pushCurrentObjects();
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
    [textEditor, screenToCanvas, pushCurrentObjects],
  );

  const cancelTextEditor = useCallback(() => {
    setTextEditor(null);
    setTextDraft("");
  }, []);

  const openTextObjectEditor = useCallback(
    (obj: TextObject) => {
      const canvas = shotRef.current;
      if (!canvas || !selection) return;
      const scaleX = canvas.width / Math.max(1, selection.width);
      const scaleY = canvas.height / Math.max(1, selection.height);
      const viewport = shotViewportRef.current;
      const scrollTop = viewport?.scrollTop ?? 0;
      const textLeft = selection.x + obj.canvasX / scaleX;
      const textTop = selection.y + obj.canvasY / scaleY - scrollTop;
      setSelectedTextId(obj.id);
      setTextDraft(obj.text);
      setTextEditor({
        id: obj.id,
        canvasX: obj.canvasX,
        canvasY: obj.canvasY,
        left: Math.max(8, textLeft),
        top: Math.max(8, textTop),
        scale: obj.scale,
        transformScale: obj.transformScale,
        width: obj.width,
        height: obj.height,
        fontSize: obj.fontSize,
        color: obj.color,
        font: obj.font,
        bold: obj.bold,
        strokeColor: obj.strokeColor,
        strokeWidth: obj.strokeWidth,
      });
      lastTextFontSize.current = obj.fontSize;
      setStrokeColor(obj.color);
      setTextStyle({
        fontSize: nearestTextSize(obj.fontSize * obj.transformScale),
        color: obj.color,
        font: obj.font,
        bold: obj.bold,
        strokeColor: obj.strokeColor,
        strokeWidth: obj.strokeWidth,
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
        void loadPalette();
        beginCapture();
        setSelection(null);
        setWindowCandidates(shot.windowCandidates ?? []);
        setHoveredWindow(null);
        setTool(null);
        setPickerSample(null);
        resetScene();
        cancelObjectMutation();
        resetHistory();
        fullImageRef.current = img;
        imageScaleRef.current = syncImageScale(img);
        const canvas = bgRef.current;
        if (!canvas) return;
        canvas.width = shot.imageWidth;
        canvas.height = shot.imageHeight;
        imageScaleRef.current = syncImageScale(img);
        paintBackground(null);
        captureReady();
        await waitForOverlayPaint();
        if (cancelled || current !== revision) return;
        await window.api.reportCaptureRendered(shot.generation, overlayLabel);
      } catch (err) {
        // A prewarmed overlay has no image until the first capture; waiting
        // for the ready event is expected and must not surface an error.
        if (!cancelled && !String(err).includes("No screenshot is available")) {
          fail(err instanceof Error ? err.message : "Failed to load screenshot", "selecting");
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
  }, [
    beginCapture,
    cancelObjectMutation,
    captureReady,
    fail,
    loadPalette,
    paintBackground,
    resetHistory,
    resetScene,
    setSelection,
    setTool,
  ]);

  useEffect(() => {
    if (phase === "idle" || phase === "capturing") return;
    if (phase === "editing" && selection) {
      paintBackground(selection, selection.height);
      return;
    }
    paintBackground(selection);
  }, [selection, phase, paintBackground]);

  const enterEditMode = useCallback(
    (rect: Selection) => {
      const image = fullImageRef.current;
      const bg = bgRef.current;
      if (!image || !bg) {
        setError("Screenshot not ready");
        return;
      }

      const clamped = clampSelection(rect);
      lastConfirmedSelection = { ...clamped };
      imageScaleRef.current = syncImageScale(image);

      beginEditing();
      resetScene();
      cancelObjectMutation();
      setSelection(clamped);
      setHoveredWindow(null);
      paintBackground(clamped, clamped.height, 0, true);

      // Crop synchronously from the already-frozen image — unlock tools immediately after
      requestAnimationFrame(() => {
        const canvas = shotRef.current;
        if (!canvas) {
          setError("Editor canvas missing");
          return;
        }
        const crop = selectionToImageCrop(clamped, image);

        canvas.width = crop.outputWidth;
        canvas.height = crop.outputHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const base = document.createElement("canvas");
        base.width = crop.outputWidth;
        base.height = crop.outputHeight;
        const baseContext = base.getContext("2d");
        if (!baseContext) return;
        baseContext.imageSmoothingEnabled = false;
        baseContext.drawImage(
          image,
          crop.sourceX,
          crop.sourceY,
          crop.sourceWidth,
          crop.sourceHeight,
          0,
          0,
          crop.outputWidth,
          crop.outputHeight,
        );
        shotBaseRef.current = base;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        resetHistory();
        setShotReady(true);
        setError(null);
      });
    },
    [beginEditing, cancelObjectMutation, paintBackground, resetHistory, resetScene, setSelection],
  );

  useLayoutEffect(() => {
    if (phase !== "editing") return;
    const canvas = shotRef.current;
    const base = shotBaseRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !base || !context) return;
    const scale = canvas.width / Math.max(1, selection?.width ?? canvas.width);
    renderRasterOverlay(
      context,
      base,
      rasterPreview ? [...rasterAnnotations, rasterPreview] : rasterAnnotations,
      scale,
    );
  }, [phase, rasterAnnotations, rasterPreview, selection?.width]);

  const createRecropBaseline = useCallback((): SelectionRecropBaseline | null => {
    const image = fullImageRef.current;
    const canvas = shotRef.current;
    if (!image || !canvas || !selection) return null;
    return {
      baseCrop: selectionToImageCrop(selection, image),
      baseTextObjects: textObjects,
      baseNumberObjects: numberObjects,
      baseRasterAnnotations: cloneRasterAnnotations(rasterAnnotations),
    };
  }, [numberObjects, rasterAnnotations, selection, textObjects]);

  // Re-derives the crop for a new region from the immutable screenshot and
  // translates retained annotations into the new crop coordinate system.
  const recropSelection = useCallback(
    (next: Selection, baseline: SelectionRecropBaseline) => {
      const image = fullImageRef.current;
      const canvas = shotRef.current;
      if (!image || !canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const crop = selectionToImageCrop(next, image);
      if (canvas.width !== crop.outputWidth) canvas.width = crop.outputWidth;
      if (canvas.height !== crop.outputHeight) canvas.height = crop.outputHeight;
      const base = shotBaseRef.current ?? document.createElement("canvas");
      if (base.width !== crop.outputWidth) base.width = crop.outputWidth;
      if (base.height !== crop.outputHeight) base.height = crop.outputHeight;
      const baseContext = base.getContext("2d");
      if (!baseContext) return;
      baseContext.imageSmoothingEnabled = false;
      baseContext.drawImage(
        image,
        crop.sourceX,
        crop.sourceY,
        crop.sourceWidth,
        crop.sourceHeight,
        0,
        0,
        crop.outputWidth,
        crop.outputHeight,
      );
      shotBaseRef.current = base;
      ctx.imageSmoothingEnabled = false;
      const translatedRaster = baseline.baseRasterAnnotations.map((annotation) => ({
        ...annotation,
        points: annotation.points.map((point) => mapCropPoint(point, baseline.baseCrop, crop)),
      }));
      setRasterAnnotations(translatedRaster);
      renderRasterOverlay(
        ctx,
        base,
        translatedRaster,
        crop.outputWidth / Math.max(1, next.width),
      );

      setTextObjects(
        baseline.baseTextObjects.map((item) => {
          const point = mapCropPoint(
            { x: item.canvasX, y: item.canvasY },
            baseline.baseCrop,
            crop,
          );
          return { ...item, canvasX: point.x, canvasY: point.y };
        }),
      );
      setNumberObjects(
        baseline.baseNumberObjects.map((item) => {
          const point = mapCropPoint(
            { x: item.canvasX, y: item.canvasY },
            baseline.baseCrop,
            crop,
          );
          return { ...item, canvasX: point.x, canvasY: point.y };
        }),
      );

      paintBackground(next, next.height, 0, true);
      setSelection(next);
    },
    [paintBackground, setSelection],
  );

  const beginRegionDrag = useCallback(
    (handle: ResizeHandle | "move", event: { clientX: number; clientY: number }) => {
      const baseline = createRecropBaseline();
      if (!selection || !baseline) return;

      regionDragRef.current = {
        handle,
        startX: event.clientX,
        startY: event.clientY,
        origin: selection,
        ...baseline,
      };
      // The raster changes size, so previous ImageData snapshots no longer fit.
      resetHistory();
      cancelObjectMutation();
      setSelectedTextId(null);
      setSelectedNumberId(null);
      setSelectedRasterId(null);
      setAdjustingRegion(true);
    },
    [cancelObjectMutation, createRecropBaseline, resetHistory, selection],
  );

  const applySelectionOutputSize = useCallback(
    (requested: Partial<OutputSize>) => {
      const image = fullImageRef.current;
      const baseline = createRecropBaseline();
      if (!canAdjustRegion || !image || !selection || !baseline) return false;
      const next = resizeSelectionToSize(
        selection,
        requested,
        captureSizeUnit,
        image.naturalWidth,
        image.naturalHeight,
        window.innerWidth,
        window.innerHeight,
        aspectRatio,
      );
      if (!next) return false;
      if (next.width === selection.width && next.height === selection.height) return true;

      resetHistory();
      cancelObjectMutation();
      setSelectedTextId(null);
      setSelectedNumberId(null);
      setSelectedRasterId(null);
      recropSelection(next, baseline);
      return true;
    },
    [
      canAdjustRegion,
      cancelObjectMutation,
      createRecropBaseline,
      recropSelection,
      resetHistory,
      selection,
      aspectRatio,
      captureSizeUnit,
    ],
  );

  const changeAspectPreset = useCallback(
    (preset: AspectPreset, custom?: AspectRatio) => {
      const image = fullImageRef.current;
      if (!selection || !image) return;
      if (preset === "free") {
        setAspectPreset("free");
        setAspectRatio(null);
        return;
      }
      if (preset === "custom" && !custom) {
        setAspectPreset("custom");
        setAspectRatio(null);
        return;
      }
      const currentCrop = selectionToImageCrop(selection, image);
      const presets: Record<Exclude<AspectPreset, "free" | "current" | "custom">, AspectRatio> = {
        "1:1": { width: 1, height: 1 },
        "4:3": { width: 4, height: 3 },
        "16:9": { width: 16, height: 9 },
        "9:16": { width: 9, height: 16 },
      };
      const nextRatio =
        preset === "current"
          ? normalizeAspectRatio(currentCrop.outputWidth, currentCrop.outputHeight)
          : preset === "custom"
            ? custom && normalizeAspectRatio(custom.width, custom.height)
            : presets[preset];
      if (!nextRatio) {
        setError("自定义比例必须是大于零的数字");
        return;
      }
      if (preset === "current") {
        setAspectPreset(preset);
        setAspectRatio(nextRatio);
        return;
      }
      const fitted = fitSelectionToAspectRatio(
        selection,
        nextRatio,
        image.naturalWidth,
        image.naturalHeight,
        window.innerWidth,
        window.innerHeight,
      );
      if (!fitted) {
        setError("当前选区无法容纳该比例");
        return;
      }
      setAspectPreset(preset);
      setAspectRatio(nextRatio);
      if (fitted.width !== selection.width || fitted.height !== selection.height) {
        const baseline = createRecropBaseline();
        if (!baseline) return;
        resetHistory();
        cancelObjectMutation();
        setSelectedTextId(null);
        setSelectedNumberId(null);
        setSelectedRasterId(null);
        recropSelection(fitted, baseline);
      }
    },
    [
      cancelObjectMutation,
      createRecropBaseline,
      recropSelection,
      resetHistory,
      selection,
      setError,
    ],
  );

  useOverlayKeyboard({
    blocked: Boolean(textEditor) || toolbarPopupOpen,
    tool,
    phase,
    hasSelectedText: Boolean(selectedTextId),
    hasSelectedNumber: Boolean(selectedNumberId),
    hasSelectedRaster: Boolean(selectedRasterId),
    shotReady,
    busy,
    copyPickerHex: () => void copyPickerHex(),
    exitPicker: () => {
      setTool(null);
      setPickerSample(null);
    },
    clearSelection: () => {
      setSelectedTextId(null);
      setSelectedNumberId(null);
      setSelectedRasterId(null);
    },
    deleteSelection: () => {
      if (selectedTextId || selectedNumberId || selectedRasterId) pushCurrentObjects();
      if (selectedTextId) {
        setTextObjects((previous) => previous.filter((item) => item.id !== selectedTextId));
        setSelectedTextId(null);
      }
      if (selectedNumberId) {
        setNumberObjects((previous) => previous.filter((item) => item.id !== selectedNumberId));
        setSelectedNumberId(null);
      }
      if (selectedRasterId) {
        setRasterAnnotations((previous) => previous.filter((item) => item.id !== selectedRasterId));
        setSelectedRasterId(null);
      }
    },
    cancel: cancelOverlay,
    undo,
    redo,
    confirm: () => {
      void runCommittedImageAction(window.api.copyImage, "复制截图失败");
    },
  });

  useEffect(() => {
    let pendingMove: PointerEvent | null = null;
    let moveFrame = 0;
    const processMove = (event: PointerEvent): void => {
      const canvas = shotRef.current;
      if (!canvas || !selection) return;
      const scaleX = canvas.width / Math.max(1, selection.width);
      const scaleY = canvas.height / Math.max(1, selection.height);

      const regionDrag = regionDragRef.current;
      if (regionDrag) {
        const dx = event.clientX - regionDrag.startX;
        const dy = event.clientY - regionDrag.startY;
        recropSelection(
          regionDrag.handle === "move"
            ? moveRect(regionDrag.origin, dx, dy)
            : aspectRatio && !["n", "e", "s", "w"].includes(regionDrag.handle)
              ? resizeSelectionWithAspectRatio(
                  regionDrag.origin,
                  regionDrag.handle as "nw" | "ne" | "sw" | "se",
                  dx,
                  dy,
                  aspectRatio,
                  fullImageRef.current?.naturalWidth ?? window.innerWidth,
                  fullImageRef.current?.naturalHeight ?? window.innerHeight,
                  window.innerWidth,
                  window.innerHeight,
                )
              : resizeRect(regionDrag.origin, regionDrag.handle, dx, dy),
          regionDrag,
        );
        return;
      }

      const rasterTransform = rasterTransformRef.current;
      if (rasterTransform && rasterTransform.pointerId === event.pointerId) {
        const dx = (event.clientX - rasterTransform.startX) * scaleX;
        const dy = (event.clientY - rasterTransform.startY) * scaleY;
        const next =
          rasterTransform.mode === "move"
            ? translateAnnotation(rasterTransform.origin, dx, dy, canvas.width, canvas.height)
            : resizeAnnotation(
                rasterTransform.origin,
                resizeRect(
                  rasterTransform.originBounds,
                  rasterTransform.mode,
                  dx,
                  dy,
                  canvas.width,
                  canvas.height,
                ),
              );
        rasterTransform.changed =
          JSON.stringify(next.points) !== JSON.stringify(rasterTransform.origin.points);
        setRasterAnnotations((previous) =>
          previous.map((item) => (item.id === rasterTransform.id ? next : item)),
        );
        return;
      }

      const textDrag = textDragRef.current;
      if (textDrag && textDrag.pointerId === event.pointerId) {
        const dx = (event.clientX - textDrag.startX) * scaleX;
        const dy = (event.clientY - textDrag.startY) * scaleY;
        const canvasX = Math.max(0, Math.min(textDrag.originCanvasX + dx, textDrag.maxCanvasX));
        const canvasY = Math.max(0, Math.min(textDrag.originCanvasY + dy, textDrag.maxCanvasY));
        if (canvasX !== textDrag.originCanvasX || canvasY !== textDrag.originCanvasY)
          textDrag.changed = true;
        setTextObjects((prev) =>
          prev.map((item) =>
            item.id === textDrag.id
              ? {
                  ...item,
                  canvasX,
                  canvasY,
                }
              : item,
          ),
        );
      }
      const textResize = textResizeRef.current;
      if (textResize && textResize.pointerId === event.pointerId) {
        const point = screenToCanvas(event.clientX, event.clientY);
        const resized = resizeTextBox(
          textResize.origin,
          textResize.handle,
          point.canvasX,
          point.canvasY,
          canvas.width,
          canvas.height,
        );
        if (
          resized.canvasX !== textResize.origin.canvasX ||
          resized.canvasY !== textResize.origin.canvasY ||
          resized.transformScale !== textResize.origin.transformScale
        )
          textResize.changed = true;
        setTextObjects((previous) =>
          previous.map((item) => (item.id === textResize.id ? { ...item, ...resized } : item)),
        );
      }
      const editorDrag = textEditorDragRef.current;
      if (editorDrag) {
        const dx = (event.clientX - editorDrag.startX) * scaleX;
        const dy = (event.clientY - editorDrag.startY) * scaleY;
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
      if (numberDrag && numberDrag.pointerId === event.pointerId) {
        const dx = (event.clientX - numberDrag.startX) * scaleX;
        const dy = (event.clientY - numberDrag.startY) * scaleY;
        const center = clampNumberCenter(
          numberDrag.originCanvasX + dx,
          numberDrag.originCanvasY + dy,
          numberDrag.radius,
          canvas.width,
          canvas.height,
        );
        if (
          center.canvasX !== numberDrag.originCanvasX ||
          center.canvasY !== numberDrag.originCanvasY
        )
          numberDrag.changed = true;
        setNumberObjects((previous) =>
          previous.map((item) =>
            item.id === numberDrag.id
              ? {
                  ...item,
                  ...center,
                }
              : item,
          ),
        );
      }
    };
    const flushMove = (): void => {
      moveFrame = 0;
      const event = pendingMove;
      pendingMove = null;
      if (event) processMove(event);
    };
    const onMove = (event: PointerEvent): void => {
      pendingMove = event;
      if (!moveFrame) moveFrame = requestAnimationFrame(flushMove);
    };
    const onUp = (event: PointerEvent): void => {
      if (moveFrame) cancelAnimationFrame(moveFrame);
      flushMove();
      if (rasterTransformRef.current?.pointerId === event.pointerId) {
        const changed = rasterTransformRef.current.changed;
        rasterTransformRef.current = null;
        commitObjectMutation(changed);
      }
      if (textDragRef.current?.pointerId === event.pointerId) {
        const changed = textDragRef.current.changed;
        textDragRef.current = null;
        commitObjectMutation(changed);
      }
      if (textResizeRef.current?.pointerId === event.pointerId) {
        const changed = textResizeRef.current.changed;
        textResizeRef.current = null;
        commitObjectMutation(changed);
      }
      textEditorDragRef.current = null;
      if (numberDragRef.current?.pointerId === event.pointerId) {
        const changed = numberDragRef.current.changed;
        numberDragRef.current = null;
        commitObjectMutation(changed);
      }
      if (regionDragRef.current) {
        regionDragRef.current = null;
        setAdjustingRegion(false);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      if (moveFrame) cancelAnimationFrame(moveFrame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [aspectRatio, selection, recropSelection, screenToCanvas, commitObjectMutation]);

  useEffect(() => {
    const repeatLastSelection = (event: KeyboardEvent): void => {
      if (
        phase !== "selecting" ||
        busy ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.key.toLowerCase() !== "r" ||
        !lastConfirmedSelection
      )
        return;
      event.preventDefault();
      enterEditMode(clampSelection(lastConfirmedSelection));
    };
    window.addEventListener("keydown", repeatLastSelection);
    return () => window.removeEventListener("keydown", repeatLastSelection);
  }, [busy, enterEditMode, phase]);

  useEffect(() => {
    const adjustWindowSelection = (event: KeyboardEvent): void => {
      if (phase !== "selecting" || busy || !hoveredWindow) return;
      if (event.key === "Enter") {
        event.preventDefault();
        enterEditMode(clampSelection(hoveredWindow));
        return;
      }
      const offsets: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const offset = offsets[event.key];
      if (!offset) return;
      event.preventDefault();
      setHoveredWindow((current) => (current ? moveRect(current, offset[0], offset[1]) : current));
    };
    window.addEventListener("keydown", adjustWindowSelection);
    return () => window.removeEventListener("keydown", adjustWindowSelection);
  }, [busy, enterEditMode, hoveredWindow, phase]);

  const flushBackgroundMove = useCallback(() => {
    if (backgroundMoveFrame.current !== null) {
      cancelAnimationFrame(backgroundMoveFrame.current);
      backgroundMoveFrame.current = null;
    }
    const pending = pendingBackgroundPoint.current;
    pendingBackgroundPoint.current = null;
    if (!pending || phase !== "selecting") return;

    const point = clampPoint(pending.clientX, pending.clientY);
    if (!draggingRef.current) {
      const candidate = findWindowCandidate(windowCandidates, point.x, point.y);
      const next = candidate
        ? { x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height }
        : null;
      setHoveredWindow((current) => {
        if (
          current?.x === next?.x &&
          current?.y === next?.y &&
          current?.width === next?.width &&
          current?.height === next?.height
        )
          return current;
        return next;
      });
      return;
    }

    const distance = Math.hypot(point.x - origin.current.x, point.y - origin.current.y);
    if (distance <= 3 && pendingWindowSelection.current) return;
    pendingWindowSelection.current = null;
    setSelection(
      aspectRatio
        ? selectWithAspectRatio(
            origin.current,
            point,
            aspectRatio,
            fullImageRef.current?.naturalWidth ?? window.innerWidth,
            fullImageRef.current?.naturalHeight ?? window.innerHeight,
            window.innerWidth,
            window.innerHeight,
          )
        : clampSelection(normalizeRect(origin.current.x, origin.current.y, point.x, point.y)),
    );
  }, [aspectRatio, phase, setSelection, windowCandidates]);

  const onBgMouseDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (phase !== "selecting" || busy) return;
      flushBackgroundMove();
      draggingRef.current = true;
      setDragging(true);
      const point = clampPoint(event.clientX, event.clientY);
      origin.current = point;
      pendingWindowSelection.current = hoveredWindow;
      setSelection(hoveredWindow ?? { x: point.x, y: point.y, width: 0, height: 0 });
    },
    [busy, flushBackgroundMove, hoveredWindow, phase, setSelection],
  );

  const onBgMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      pendingBackgroundPoint.current = { clientX: event.clientX, clientY: event.clientY };
      if (backgroundMoveFrame.current === null) {
        backgroundMoveFrame.current = requestAnimationFrame(flushBackgroundMove);
      }
    },
    [flushBackgroundMove],
  );

  const onBgMouseUp = useCallback(() => {
    flushBackgroundMove();
    if (!draggingRef.current || phase !== "selecting") return;
    draggingRef.current = false;
    setDragging(false);
    pendingWindowSelection.current = null;
    const current = selectionRef.current;
    if (current && current.width >= MIN_SIZE && current.height >= MIN_SIZE) {
      enterEditMode(clampSelection(current));
    } else {
      setSelection(null);
    }
  }, [enterEditMode, flushBackgroundMove, phase, setSelection, selectionRef]);

  const toLocal = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const canvas = shotRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) * canvas.width) / Math.max(1, bounds.width),
      y: ((event.clientY - bounds.top) * canvas.height) / Math.max(1, bounds.height),
    };
  };

  const samplePickerColor = useCallback(
    (event: { clientX: number; clientY: number }): PickerSample | null => {
      const image = fullImageRef.current;
      const canvas = shotRef.current;
      if (!image || !canvas || !selection) return null;
      const crop = selectionToImageCrop(selection, image);
      const point = toLocal(event);
      const imageX = Math.max(
        0,
        Math.min(
          image.naturalWidth - 1,
          Math.floor(
            crop.sourceX + (point.x / canvas.width) * crop.sourceWidth,
          ),
        ),
      );
      const imageY = Math.max(
        0,
        Math.min(
          image.naturalHeight - 1,
          Math.floor(
            crop.sourceY + (point.y / canvas.height) * crop.sourceHeight,
          ),
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
      const position = calculatePickerPosition(
        event.clientX,
        event.clientY,
        window.innerWidth,
        window.innerHeight,
      );
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
        ...position,
      };
      setPickerSample(sample);
      return sample;
    },
    [selection],
  );

  const cancelPickerSample = useCallback(() => {
    if (pickerSampleFrame.current !== null) cancelAnimationFrame(pickerSampleFrame.current);
    pickerSampleFrame.current = null;
    pendingPickerPoint.current = null;
  }, []);

  const flushPickerSample = useCallback(() => {
    pickerSampleFrame.current = null;
    const pending = pendingPickerPoint.current;
    pendingPickerPoint.current = null;
    if (tool === "picker" && pending) samplePickerColor(pending);
  }, [samplePickerColor, tool]);

  const queuePickerSample = useCallback(
    (event: NativeCanvasPoint) => {
      if (tool !== "picker") return;
      pendingPickerPoint.current = { clientX: event.clientX, clientY: event.clientY };
      if (pickerSampleFrame.current === null) {
        pickerSampleFrame.current = requestAnimationFrame(flushPickerSample);
      }
    },
    [flushPickerSample, tool],
  );

  const beginNativeCanvasInput = useCallback(
    (
      owner: NativeInputOwner,
      event: NativeCanvasPoint & { button: number; preventDefault: () => void },
    ): boolean => {
      if (event.button !== 0) return false;
      if (phase !== "editing" || busy || !shotReady) return false;
      if (textEditor) {
        commitText(textDraft);
        return false;
      }
      if (tool === "text" && selectedTextId) {
        setSelectedTextId(null);
        return false;
      }
      setSelectedTextId(null);
      setSelectedNumberId(null);
      if (!tool) {
        if (canAdjustRegion) {
          event.preventDefault();
          beginRegionDrag("move", event);
        }
        return false;
      }
      if (tool === "picker") {
        cancelPickerSample();
        const sample = samplePickerColor(event);
        if (sample) {
          setStrokeColor(`#${sample.hex}`);
          // Clicking with the eyedropper is an explicit copy action. This is
          // also the sole path that adds a sampled colour to recent history.
          void copyPickerSample(sample);
        }
        return false;
      }
      const canvas = shotRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) {
        setError("截图画布不可用，请重新截图");
        return false;
      }
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
          transformScale: 1,
          width: 260,
          height: 96,
          ...textStyle,
        });
        setTextDraft("");
        return false;
      }

      if (tool === "number") {
        pushCurrentObjects();
        setNumberObjects((previous) => {
          const radius = Math.max(12, (numberStyle.size * scale) / 2);
          const center = clampNumberCenter(point.x, point.y, radius, canvas.width, canvas.height);
          return appendNumberObject(previous, {
            id: `number-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            ...center,
            style: { ...numberStyle },
          });
        });
        return false;
      }

      if (!["rect", "ellipse", "arrow", "pen", "highlight", "mosaic"].includes(tool)) return false;
      event.preventDefault();
      const gesture: ActiveAnnotationGesture = {
        ...createAnnotationGesture(
          owner.id,
          tool as RasterTool,
          point,
          cloneRasterAnnotations(objectStateRef.current.rasterAnnotations),
        ),
        id: `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        settings: {
          strokeColor,
          strokeWidth,
          fillOpacity,
          arrowStyle,
          arrowHeadSize,
          penWidth,
          highlightWidth,
          highlightOpacity,
          mosaicBlock,
        },
      };
      annotationGestureRef.current = gesture;
      if (gesture.tool === "pen") setRasterPreview(rasterFromGesture(gesture, scale));
      return true;
    },
    [
      phase,
      busy,
      tool,
      shotReady,
      selection,
      strokeColor,
      strokeWidth,
      fillOpacity,
      arrowStyle,
      arrowHeadSize,
      textStyle,
      numberStyle,
      pushCurrentObjects,
      penWidth,
      highlightWidth,
      highlightOpacity,
      mosaicBlock,
      canAdjustRegion,
      beginRegionDrag,
      cancelPickerSample,
      samplePickerColor,
      copyPickerSample,
      textEditor,
      textDraft,
      commitText,
      selectedTextId,
    ],
  );

  const flushAnnotationPreview = useCallback(() => {
    annotationPreviewFrame.current = null;
    const gesture = annotationGestureRef.current;
    const canvas = shotRef.current;
    if (!gesture || !canvas) return;
    setRasterPreview(rasterFromGesture(gesture, annotationPreviewScale.current));
  }, []);

  const cancelAnnotationPreview = useCallback(() => {
    if (annotationPreviewFrame.current !== null) cancelAnimationFrame(annotationPreviewFrame.current);
    annotationPreviewFrame.current = null;
  }, []);

  const queueAnnotationPreview = useCallback(
    (scale: number) => {
      annotationPreviewScale.current = scale;
      if (annotationPreviewFrame.current === null) {
        annotationPreviewFrame.current = requestAnimationFrame(flushAnnotationPreview);
      }
    },
    [flushAnnotationPreview],
  );

  const moveNativeCanvasInput = useCallback(
    (owner: NativeInputOwner, event: NativeCanvasPoint) => {
      const gesture = annotationGestureRef.current;
      if (!shouldHandlePointer(gesture, owner.id) || phase !== "editing") return;
      const canvas = shotRef.current;
      if (!canvas) {
        annotationGestureRef.current = null;
        setError("截图画布在绘制过程中不可用，请重新截图");
        return;
      }
      const point = toLocal(event);
      const scale = canvas.width / Math.max(1, selection?.width || canvas.width);
      appendGesturePoint(gesture, point);
      if (!gesture.changed) return;

      queueAnnotationPreview(scale);
    },
    [phase, queueAnnotationPreview, selection],
  );

  const finishNativeCanvasInput = useCallback(
    (owner: NativeInputOwner) => {
      const gesture = annotationGestureRef.current;
      if (!shouldHandlePointer(gesture, owner.id)) return;
      flushAnnotationPreview();
      cancelAnnotationPreview();
      annotationGestureRef.current = null;
      const canvas = shotRef.current;
      const scale = canvas ? canvas.width / Math.max(1, selection?.width ?? canvas.width) : 1;
      const preview = rasterFromGesture(gesture, scale);
      setRasterPreview(null);
      if (resolveAnnotationGesture(gesture, false).commit && preview) {
        pushCurrentObjects();
        setRasterAnnotations([...gesture.baseline, preview]);
        setSelectedRasterId(preview.id);
      }
    },
    [cancelAnnotationPreview, flushAnnotationPreview, pushCurrentObjects, selection?.width],
  );

  const cancelNativeCanvasInput = useCallback((owner: NativeInputOwner) => {
    const gesture = annotationGestureRef.current;
    if (!shouldHandlePointer(gesture, owner.id)) return;
    cancelAnnotationPreview();
    resolveAnnotationGesture(gesture, true);
    setRasterPreview(null);
    annotationGestureRef.current = null;
  }, [cancelAnnotationPreview]);

  nativeCanvasHandlersRef.current = {
    begin: beginNativeCanvasInput,
    move: moveNativeCanvasInput,
    finish: finishNativeCanvasInput,
    cancel: cancelNativeCanvasInput,
    sample: (event) => {
      queuePickerSample(event);
    },
    clearSample: () => {
      if (tool === "picker") {
        cancelPickerSample();
        setPickerSample(null);
      }
    },
  };

  useLayoutEffect(() => {
    if (phase !== "editing") return;
    const canvas = shotRef.current;
    if (!canvas) return;
    const gate = nativeInputGateRef.current;
    const handlers = (): NativeCanvasHandlers | null => nativeCanvasHandlersRef.current;

    const mouseDown = (event: MouseEvent): void => {
      const owner = gate.beginMouse(performance.now());
      if (!owner) return;
      if (!handlers()?.begin(owner, event)) gate.release(owner.source, owner.id);
    };
    const canvasMouseMove = (event: MouseEvent): void => {
      if (!gate.current()) handlers()?.sample(event);
    };
    const canvasMouseLeave = (): void => {
      handlers()?.clearSample();
    };
    const windowMouseMove = (event: MouseEvent): void => {
      if (gate.owns("mouse", -1)) handlers()?.move({ source: "mouse", id: -1 }, event);
    };
    const mouseUp = (): void => {
      if (!gate.owns("mouse", -1)) return;
      const owner = { source: "mouse", id: -1 } as const;
      handlers()?.finish(owner);
      gate.release(owner.source, owner.id);
    };
    const pointerDown = (event: PointerEvent): void => {
      const owner = gate.beginPointer(event.pointerId, event.pointerType, performance.now());
      if (!owner) return;
      if (!handlers()?.begin(owner, event)) {
        gate.release(owner.source, owner.id);
        return;
      }
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Window listeners keep the gesture alive when WebView2 refuses capture.
      }
    };
    const pointerMove = (event: PointerEvent): void => {
      if (gate.owns("pointer", event.pointerId)) {
        handlers()?.move({ source: "pointer", id: event.pointerId }, event);
      }
    };
    const canvasPointerMove = (event: PointerEvent): void => {
      if (event.pointerType !== "mouse" && !gate.current()) handlers()?.sample(event);
    };
    const pointerUp = (event: PointerEvent): void => {
      if (!gate.owns("pointer", event.pointerId)) return;
      const owner = { source: "pointer", id: event.pointerId } as const;
      handlers()?.finish(owner);
      gate.release(owner.source, owner.id);
    };
    const pointerCancel = (event: PointerEvent): void => {
      if (!gate.owns("pointer", event.pointerId)) return;
      const owner = { source: "pointer", id: event.pointerId } as const;
      handlers()?.cancel(owner);
      gate.release(owner.source, owner.id);
    };
    const blur = (): void => {
      const owner = gate.current();
      if (owner) handlers()?.cancel(owner);
      gate.reset();
    };

    canvas.addEventListener("mousedown", mouseDown);
    canvas.addEventListener("mousemove", canvasMouseMove);
    canvas.addEventListener("mouseleave", canvasMouseLeave);
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", canvasPointerMove);
    window.addEventListener("mousemove", windowMouseMove);
    window.addEventListener("mouseup", mouseUp);
    window.addEventListener("pointermove", pointerMove);
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerCancel);
    window.addEventListener("blur", blur);
    return () => {
      blur();
      canvas.removeEventListener("mousedown", mouseDown);
      canvas.removeEventListener("mousemove", canvasMouseMove);
      canvas.removeEventListener("mouseleave", canvasMouseLeave);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", canvasPointerMove);
      window.removeEventListener("mousemove", windowMouseMove);
      window.removeEventListener("mouseup", mouseUp);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerCancel);
      window.removeEventListener("blur", blur);
    };
  }, [phase]);

  const shotViewportHeight = displayHeight;

  const secondarySize = tool && secondaryToolbarSize.width > 0 ? secondaryToolbarSize : undefined;
  const toolbarLayout =
    selection && phase === "editing" && primaryToolbarSize.width > 0
      ? calculateToolbarLayout(selection, viewportSize, primaryToolbarSize, secondarySize)
      : undefined;
  const toolbarMeasured = Boolean(
    toolbarLayout && (!tool || (secondarySize && toolbarLayout.secondary)),
  );

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
    const selectedText = objectStateRef.current.textObjects.find(
      (item) => item.id === selectedTextId,
    );
    const selectedNumber = objectStateRef.current.numberObjects.find(
      (item) => item.id === selectedNumberId,
    );
    const selectedRaster = objectStateRef.current.rasterAnnotations.find(
      (item) => item.id === selectedRasterId,
    );
    const canvas = shotRef.current;
    const annotationScale = canvas
      ? canvas.width / Math.max(1, selection?.width ?? canvas.width)
      : 1;
    const rasterStylePatch: Partial<RasterAnnotation["style"]> = {};
    if (changes.strokeColor !== undefined) rasterStylePatch.color = changes.strokeColor;
    if (changes.fillOpacity !== undefined) rasterStylePatch.fillOpacity = changes.fillOpacity;
    if (changes.arrowStyle !== undefined) rasterStylePatch.arrowStyle = changes.arrowStyle;
    if (changes.arrowHeadSize !== undefined) rasterStylePatch.arrowHeadSize = changes.arrowHeadSize;
    if (
      changes.strokeWidth !== undefined &&
      selectedRaster?.kind !== "pen" &&
      selectedRaster?.kind !== "highlight"
    )
      rasterStylePatch.strokeWidth = changes.strokeWidth * annotationScale;
    if (changes.penWidth !== undefined && selectedRaster?.kind === "pen")
      rasterStylePatch.strokeWidth = changes.penWidth * annotationScale;
    if (changes.highlightWidth !== undefined && selectedRaster?.kind === "highlight")
      rasterStylePatch.strokeWidth = changes.highlightWidth * annotationScale;
    if (changes.highlightOpacity !== undefined && selectedRaster?.kind === "highlight")
      rasterStylePatch.opacity = changes.highlightOpacity;
    if (changes.mosaicBlock !== undefined && selectedRaster?.kind === "mosaic")
      rasterStylePatch.mosaicBlock = changes.mosaicBlock * annotationScale;
    const changesRaster = Boolean(
      selectedRaster &&
      (Object.keys(rasterStylePatch) as Array<keyof RasterAnnotation["style"]>).some(
        (key) => rasterStylePatch[key] !== selectedRaster.style[key],
      ),
    );
    const changesSelectedObject = Boolean(
      (changes.textStyle !== undefined &&
        selectedText &&
        (Object.keys(changes.textStyle) as Array<keyof TextStyle>).some(
          (key) => changes.textStyle![key] !== selectedText[key],
        )) ||
      (changes.numberStyle !== undefined &&
        selectedNumber &&
        JSON.stringify(changes.numberStyle) !== JSON.stringify(selectedNumber.style)) ||
      changesRaster,
    );
    const immediateObjectMutation = changesSelectedObject && !objectMutationRef.current.active;
    if (immediateObjectMutation) beginObjectMutation();
    if (changes.strokeColor !== undefined) setStrokeColor(changes.strokeColor);
    if (changes.strokeWidth !== undefined) setStrokeWidth(changes.strokeWidth);
    if (changes.fillOpacity !== undefined) setFillOpacity(changes.fillOpacity);
    if (changes.arrowStyle !== undefined) setArrowStyle(changes.arrowStyle);
    if (changes.arrowHeadSize !== undefined) setArrowHeadSize(changes.arrowHeadSize);
    if (changes.penWidth !== undefined) setPenWidth(changes.penWidth);
    if (changes.highlightWidth !== undefined) setHighlightWidth(changes.highlightWidth);
    if (changes.highlightOpacity !== undefined) setHighlightOpacity(changes.highlightOpacity);
    if (changes.mosaicBlock !== undefined) setMosaicBlock(changes.mosaicBlock);
    if (selectedRaster && changesRaster) {
      objectStyleChangedRef.current = true;
      setRasterAnnotations((previous) =>
        previous.map((item) =>
          item.id === selectedRaster.id
            ? { ...item, style: { ...item.style, ...rasterStylePatch } }
            : item,
        ),
      );
    }
    if (changes.numberStyle !== undefined) {
      setNumberStyle(changes.numberStyle);
      if (selectedNumberId) {
        if (changesSelectedObject) objectStyleChangedRef.current = true;
        const scale = canvas ? canvas.width / Math.max(1, selection?.width ?? canvas.width) : 1;
        setNumberObjects((previous) =>
          previous.map((item) =>
            item.id === selectedNumberId
              ? {
                  ...item,
                  ...(canvas
                    ? clampNumberCenter(
                        item.canvasX,
                        item.canvasY,
                        Math.max(12, (changes.numberStyle!.size * scale) / 2),
                        canvas.width,
                        canvas.height,
                      )
                    : {}),
                  style: { ...changes.numberStyle! },
                }
              : item,
          ),
        );
      }
    }
    if (changes.textStyle !== undefined) {
      const nextStyle = changes.textStyle;
      const styleDelta: Partial<typeof textStyle> = {};
      (Object.keys(nextStyle) as Array<keyof typeof textStyle>).forEach((key) => {
        if (nextStyle[key] !== textStyle[key]) Object.assign(styleDelta, { [key]: nextStyle[key] });
      });
      const fontSizeChanged = styleDelta.fontSize !== undefined;
      setTextStyle(changes.textStyle);
      lastTextFontSize.current = changes.textStyle.fontSize;
      setTextEditor((current) =>
        current
          ? {
              ...current,
              ...styleDelta,
              transformScale: fontSizeChanged ? 1 : current.transformScale,
              width: fontSizeChanged ? current.width * current.transformScale : current.width,
              height: fontSizeChanged ? current.height * current.transformScale : current.height,
            }
          : current,
      );
      if (selectedTextId) {
        if (Object.keys(styleDelta).length > 0) objectStyleChangedRef.current = true;
        setTextObjects((previous) =>
          previous.map((item) =>
            item.id === selectedTextId
              ? {
                  ...item,
                  ...styleDelta,
                  transformScale: fontSizeChanged ? 1 : item.transformScale,
                  width: fontSizeChanged ? item.width * item.transformScale : item.width,
                  height: fontSizeChanged ? item.height * item.transformScale : item.height,
                }
              : item,
          ),
        );
      }
    }
    if (immediateObjectMutation) {
      commitObjectMutation(true);
      objectStyleChangedRef.current = false;
    }
    if (changes.pickerFormat !== undefined) {
      void updateScreenshotConfig(
        { color_copy_format: changes.pickerFormat },
        "取色复制格式保存失败",
      );
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
          className="shot-viewport"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: shotViewportHeight,
          }}
        >
          <canvas
            ref={shotRef}
            className={`shot-canvas${canAdjustRegion ? " shot-canvas--movable" : ""}${tool === "picker" ? " shot-canvas--picker" : ""}`}
            style={{
              width: selection.width,
              height: displayHeight,
            }}
          />
          {rasterAnnotations.map((annotation) => {
            const canvas = shotRef.current;
            const scaleX = canvas ? canvas.width / Math.max(1, selection.width) : 1;
            const scaleY = canvas ? canvas.height / Math.max(1, displayHeight) : scaleX;
            const bounds = annotationBounds(annotation);
            const interactive = tool === annotation.kind;
            const selected = interactive && selectedRasterId === annotation.id;
            return (
              <div
                key={annotation.id}
                className={`raster-object${interactive ? " is-interactive" : ""}${selected ? " is-selected" : ""}`}
                style={{
                  left: bounds.x / scaleX,
                  top: bounds.y / scaleY,
                  width: bounds.width / scaleX,
                  height: bounds.height / scaleY,
                  pointerEvents: interactive ? "auto" : "none",
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setSelectedRasterId(annotation.id);
                  setSelectedTextId(null);
                  setSelectedNumberId(null);
                  setStrokeColor(annotation.style.color);
                  setStrokeWidth(Math.max(1, Math.round(annotation.style.strokeWidth / scaleX)));
                  setFillOpacity(annotation.style.fillOpacity);
                  setArrowStyle(annotation.style.arrowStyle);
                  setArrowHeadSize(annotation.style.arrowHeadSize);
                  if (annotation.kind === "pen")
                    setPenWidth(Math.max(1, Math.round(annotation.style.strokeWidth / scaleX)));
                  if (annotation.kind === "highlight") {
                    setHighlightWidth(
                      Math.max(1, Math.round(annotation.style.strokeWidth / scaleX)),
                    );
                    setHighlightOpacity(annotation.style.opacity);
                  }
                  if (annotation.kind === "mosaic")
                    setMosaicBlock(Math.max(2, Math.round(annotation.style.mosaicBlock / scaleX)));
                  rasterTransformRef.current = {
                    pointerId: event.pointerId,
                    id: annotation.id,
                    mode: "move",
                    startX: event.clientX,
                    startY: event.clientY,
                    origin: cloneRasterAnnotations([annotation])[0],
                    originBounds: bounds,
                    changed: false,
                  };
                  beginObjectMutation();
                }}
              >
                {selected &&
                  (["nw", "ne", "sw", "se"] as ResizeHandle[]).map((handle) => (
                    <span
                      key={handle}
                      className={`raster-object__resize raster-object__resize--${handle}`}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        rasterTransformRef.current = {
                          pointerId: event.pointerId,
                          id: annotation.id,
                          mode: handle,
                          startX: event.clientX,
                          startY: event.clientY,
                          origin: cloneRasterAnnotations([annotation])[0],
                          originBounds: bounds,
                          changed: false,
                        };
                        beginObjectMutation();
                      }}
                    />
                  ))}
              </div>
            );
          })}
          {textObjects.map((obj) => {
            if (textEditor?.id === obj.id) return null;
            const canvas = shotRef.current;
            const scaleX = canvas ? canvas.width / Math.max(1, selection.width) : 1;
            const scaleY = canvas ? canvas.height / Math.max(1, displayHeight) : scaleX;
            const canvasWidth = canvas?.width ?? selection.width;
            const canvasHeight = canvas?.height ?? displayHeight;
            return (
              <div
                key={obj.id}
                className={`text-object${textObjectsInteractive ? " is-interactive" : ""}${selectedTextId === obj.id && textObjectsInteractive ? " is-selected" : ""}`}
                style={{
                  left: obj.canvasX / scaleX,
                  top: obj.canvasY / scaleY,
                  width: (obj.width * obj.transformScale) / scaleX,
                  minHeight: (obj.height * obj.transformScale) / scaleY,
                  color: obj.color,
                  fontSize: obj.fontSize * obj.transformScale,
                  fontFamily: fontFamily(obj.font),
                  fontWeight: obj.bold ? 700 : 400,
                  WebkitTextStroke: obj.strokeWidth
                    ? `${obj.strokeWidth * obj.transformScale}px ${obj.strokeColor}`
                    : undefined,
                  lineHeight: 1.25,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                  pointerEvents: textObjectsInteractive ? "auto" : "none",
                  padding: `${4 * obj.transformScale}px`,
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setSelectedTextId(obj.id);
                  setSelectedNumberId(null);
                  setTool("text");
                  setTextStyle({
                    fontSize: nearestTextSize(obj.fontSize * obj.transformScale),
                    color: obj.color,
                    font: obj.font,
                    bold: obj.bold,
                    strokeColor: obj.strokeColor,
                    strokeWidth: obj.strokeWidth,
                  });
                  textDragRef.current = {
                    pointerId: event.pointerId,
                    id: obj.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    originCanvasX: obj.canvasX,
                    originCanvasY: obj.canvasY,
                    maxCanvasX: Math.max(0, canvasWidth - obj.width * obj.transformScale),
                    maxCanvasY: Math.max(0, canvasHeight - obj.height * obj.transformScale),
                    changed: false,
                  };
                  beginObjectMutation();
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openTextObjectEditor(obj);
                }}
              >
                {obj.text}
                {selectedTextId === obj.id &&
                  textObjectsInteractive &&
                  TEXT_RESIZE_HANDLES.map((handle) => (
                    <span
                      key={handle}
                      className={`text-object__resize text-object__resize--${handle}`}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        textDragRef.current = null;
                        textResizeRef.current = {
                          pointerId: event.pointerId,
                          id: obj.id,
                          handle,
                          origin: obj,
                          changed: false,
                        };
                        beginObjectMutation();
                      }}
                    />
                  ))}
              </div>
            );
          })}
          {numberObjects.map((item) => {
            const canvas = shotRef.current;
            const scaleX = canvas ? canvas.width / Math.max(1, selection.width) : 1;
            const scaleY = canvas ? canvas.height / Math.max(1, selection.height) : 1;
            const displayScale = (scaleX + scaleY) / 2;
            return (
              <div
                key={item.id}
                className={`number-object${isNumberObjectInteractive(tool) ? " is-interactive" : ""}${selectedNumberId === item.id && isNumberObjectInteractive(tool) ? " is-selected" : ""}`}
                style={{
                  left: item.canvasX / scaleX,
                  top: item.canvasY / scaleY,
                  width: item.style.size,
                  height: item.style.size,
                  backgroundColor: item.style.backgroundColor,
                  color: item.style.textColor,
                  fontSize: Math.round(item.style.size * 0.56),
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setSelectedNumberId(item.id);
                  setSelectedTextId(null);
                  setNumberStyle({ ...item.style });
                  numberDragRef.current = {
                    pointerId: event.pointerId,
                    id: item.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    originCanvasX: item.canvasX,
                    originCanvasY: item.canvasY,
                    radius: Math.max(12, (item.style.size * displayScale) / 2),
                    changed: false,
                  };
                  beginObjectMutation();
                }}
              >
                {item.value}
              </div>
            );
          })}
          {textEditor &&
            (() => {
              const canvas = shotRef.current;
              const scaleX = canvas ? canvas.width / Math.max(1, selection.width) : 1;
              const scaleY = canvas ? canvas.height / Math.max(1, selection.height) : 1;
              return (
                <div
                  className="inline-text-editor"
                  style={{
                    left: textEditor.canvasX / scaleX,
                    top: textEditor.canvasY / scaleY,
                    width: (textEditor.width * textEditor.transformScale) / scaleX,
                    minHeight: (textEditor.height * textEditor.transformScale) / scaleY,
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
                      fontSize: textEditor.fontSize * textEditor.transformScale,
                      fontWeight: textEditor.bold ? 700 : 400,
                      WebkitTextStroke: textEditor.strokeWidth
                        ? `${textEditor.strokeWidth * textEditor.transformScale}px ${textEditor.strokeColor}`
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
                                width: (rect.width * scaleX) / current.transformScale,
                                height: Math.max(
                                  current.height,
                                  (rect.height * scaleY) / current.transformScale,
                                ),
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
        RESIZE_HANDLES.filter((handle) => !aspectRatio || !["n", "e", "s", "w"].includes(handle)).map((handle) => {
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

      {selectionSizePanel && (phase === "selecting" || phase === "editing") && (
        <SelectionSizePanel
          size={selectionSizePanel.size}
          limits={selectionSizePanel.limits}
          position={selectionSizePanel.position}
          unit={captureSizeUnit}
          aspectPreset={aspectPreset}
          aspectRatio={aspectRatio}
          showInputs={phase === "editing"}
          editable={canAdjustRegion}
          savingUnit={screenshotConfigSaving}
          onUnitChange={(unit) => {
            void updateScreenshotConfig({ capture_size_unit: unit }, "截图尺寸单位保存失败");
          }}
          onAspectChange={changeAspectPreset}
          onCommit={applySelectionOutputSize}
        />
      )}

      {phase === "editing" && tool === "text" && !textEditor && textObjects.length > 0 && (
        <div className="overlay-interaction-hint">{t.textEditor.moveHint}</div>
      )}

      {phase === "capturing" && <div className="overlay-status">{t.hints.capturing}</div>}

      {phase === "selecting" && !selection && !error && (
        <div className="overlay-hint-bar">{t.hints.dragToSelect}</div>
      )}

      {phase === "selecting" && !dragging && hoveredWindow && (
        <div
          className="window-candidate-highlight"
          style={{
            left: hoveredWindow.x,
            top: hoveredWindow.y,
            width: hoveredWindow.width,
            height: hoveredWindow.height,
          }}
        />
      )}

      {error && <div className="overlay-hint-bar overlay-hint-bar--error">{error}</div>}

      {phase === "editing" && (ocrRunning || ocrPanel.result || ocrPanel.error) && (
        <div className="ocr-result-panel" onMouseDown={(event) => event.stopPropagation()}>
          <div className="ocr-result-panel__header">
            <strong>{t.ocr.title}</strong>
            <span>{t.ocr.onnxEngine}</span>
            <button type="button" onClick={dismissOcr}>
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
            {ocrPanel.result?.blocks.length ? (
              <div className="ocr-result-panel__blocks">
                {ocrPanel.result.blocks.map((block, index) => (
                  <button
                    type="button"
                    key={`${block.x}-${block.y}-${index}`}
                    onMouseEnter={() => setActiveOcrBlock(block)}
                    onMouseLeave={() => setActiveOcrBlock(null)}
                    onClick={() => void window.api.copyText(block.text)}
                  >
                    <span>{block.text}</span>
                    <small>{Math.round(block.confidence * 100)}%</small>
                  </button>
                ))}
              </div>
            ) : null}
            {ocrPanel.error && <p className="ocr-result-panel__hint">{ocrPanel.error}</p>}
          </section>
        </div>
      )}

      {phase === "editing" && selection && activeOcrBlock && (
        <div
          className="ocr-block-highlight"
          style={{
            left: selection.x + activeOcrBlock.x / imageScaleRef.current.scaleX,
            top: selection.y + activeOcrBlock.y / imageScaleRef.current.scaleY,
            width: activeOcrBlock.width / imageScaleRef.current.scaleX,
            height: activeOcrBlock.height / imageScaleRef.current.scaleY,
          }}
        />
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

      {phase === "editing" && tool === "picker" && pickerSample && fullImageRef.current && (
        <div className="picker-preview" style={{ left: pickerSample.left, top: pickerSample.top }}>
          <div className="picker-preview__zoom">
            <canvas ref={pickerZoomRef} width={120} height={120} />
            <span />
          </div>
          <div className="picker-preview__meta">
            <div className="picker-preview__color-row">
              <i style={{ backgroundColor: `#${pickerSample.hex}` }} />
              <strong>{pickerCopied ? "已复制" : `#${pickerSample.hex}`}</strong>
            </div>
          </div>
        </div>
      )}

      {phase === "editing" && selection && (
        <>
          <AnnotationToolbar
            ref={primaryToolbarRef}
            tool={tool}
            canUndo={canUndo}
            canRedo={canRedo}
            compact={compactToolbar}
            toolsDisabled={toolsLocked}
            confirmDisabled={toolsLocked}
            ocrDisabled={!selection || !shotReady || ocrRunning}
            ocrRunning={ocrRunning}
            onPopupOpenChange={reportPrimaryPopup}
            style={{
              left: toolbarLayout?.primary.left ?? 8,
              top: toolbarLayout?.primary.top ?? 8,
              visibility: toolbarMeasured ? "visible" : "hidden",
            }}
            onToolChange={(next) => {
              if (textEditor) commitText(textDraft);
              if (objectMutationRef.current.active) {
                commitObjectMutation(objectStyleChangedRef.current);
                objectStyleChangedRef.current = false;
              }
              openToolbarPopups.current.clear();
              setToolbarPopupOpen(false);
              setSecondaryToolbarSize(EMPTY_TOOLBAR_SIZE);
              setTool(next);
              const selectedRaster = objectStateRef.current.rasterAnnotations.find(
                (item) => item.id === selectedRasterId,
              );
              if (!selectedRaster || next !== selectedRaster.kind) setSelectedRasterId(null);
              if (next !== "text") setSelectedTextId(null);
              if (next !== "picker") setPickerSample(null);
              if (next !== "number") setSelectedNumberId(null);
            }}
            onUndo={undo}
            onRedo={redo}
            onSave={() => {
              void runCommittedImageAction(window.api.saveImage, "保存截图失败");
            }}
            onPin={() => {
              void runCommittedImageAction(window.api.pinImage, "贴图失败");
            }}
            onOcr={recognizeSelection}
            onQr={() => {
              if (!selection || !shotReady || ocrRunning) return;
              const generation = qrRequest.current.next();
              void (async () => {
                let imageId: string | null = null;
                try {
                  const png = await exportOcrPng();
                  if (!qrRequest.current.isCurrent(generation)) return;
                  imageId = await window.api.uploadImage(png);
                  if (!qrRequest.current.isCurrent(generation)) {
                    await window.api.releaseImage(imageId);
                    return;
                  }
                  const result = await window.api.decodeQrSelection(imageId);
                  imageId = null;
                  if (qrRequest.current.isCurrent(generation)) setQrContents(result.contents);
                } catch (err) {
                  if (imageId) await window.api.releaseImage(imageId).catch(() => undefined);
                  if (qrRequest.current.isCurrent(generation)) {
                    setError(err instanceof Error ? err.message : "二维码识别失败");
                  }
                }
              })();
            }}
            onCancel={cancelOverlay}
            onConfirm={() => {
              void runCommittedImageAction(window.api.copyImage, "复制截图失败");
            }}
          />
          {tool && (
            <ToolOptionsBar
              key={tool}
              ref={secondaryToolbarRef}
              tool={tool}
              settings={toolSettings}
              onChange={updateToolSettings}
              onPopupOpenChange={reportSecondaryPopup}
              palette={palette}
              paletteBusy={paletteBusy}
              onPaletteCopy={(color) => void copyPaletteColor(color)}
              onPaletteFavorite={(color, favorite) => void setPaletteFavorite(color, favorite)}
              style={{
                left: toolbarLayout?.secondary?.left ?? 8,
                top: toolbarLayout?.secondary?.top ?? 8,
                visibility: toolbarMeasured ? "visible" : "hidden",
              }}
            />
          )}
        </>
      )}

      {busy && <div className="overlay-status">{t.hints.working}</div>}
    </div>
  );
}

export default ScreenshotOverlay;
