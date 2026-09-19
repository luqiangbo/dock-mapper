import {
  useCallback,
  useEffect,
  lazy,
  Suspense,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CaptureSelectionTrace, WindowCandidate } from "../../../api/screenshotTypes";
import type { AnnotationOutlineConfig } from "../../../types";
import { useI18n } from "../i18n";
import { paletteApi } from "../../../api/commands";
import AnnotationToolbar, { type AnnotTool } from "./AnnotationToolbar";
import type {
  ExcalidrawCrop,
  ExcalidrawEditorStatus,
  ExcalidrawScreenshotEditorHandle,
  ExcalidrawSelectionState,
} from "./ExcalidrawScreenshotEditor";
import { loadImageFromUrl } from "../utils/imageLoad";
import { fontFamily, TEXT_SIZES, type TextObject, type TextSize } from "./textTypes";
import ToolOptionsBar from "./ToolOptionsBar";
import {
  isExcalidrawStyleTool,
  isSameExcalidrawSelection,
} from "./excalidrawScreenshotAdapter";
import { clearArrowRenderCache } from "./arrowGeometry";
import { useOcr } from "../hooks/useOcr";
import { RequestGeneration } from "../hooks/requestGeneration";
import { useCaptureLifecycle, type Selection } from "../hooks/useCaptureLifecycle";
import { useEditorSceneState } from "../hooks/useEditorSceneState";
import { useOverlayKeyboard } from "../hooks/useOverlayKeyboard";
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
import SelectionSizePanel, {
  SELECTION_SIZE_PANEL_SIZE,
  SELECTION_SIZE_CUSTOM_PANEL_SIZE,
  SELECTION_SIZE_BADGE_SIZE,
  type AspectPreset,
} from "./SelectionSizePanel";
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
  type OutputSize,
} from "./selectionSizeGeometry";
import {
  DEFAULT_NUMBER_STYLE,
  DEFAULT_LINE_STYLE,
  DEFAULT_TEXT_STYLE,
  normalizeArrowStyle,
  normalizeExcalidrawStrokeWidth,
  normalizeLineStyle,
  type ArrowStyle,
  type Arrowhead,
  type FillStyle,
  type FrameShape,
  type LineStyle,
  type Roughness,
  type TextStyle,
  type ToolSettings,
} from "./annotationTypes";
import { calculateToolbarLayout } from "./toolbarLayout";
import {
  appendGesturePoint,
  createAnnotationGesture,
  resolveAnnotationGesture,
  shouldHandlePointer,
  type RasterTool,
} from "./annotationGesture";
import { resizeTextBox, TEXT_RESIZE_HANDLES, type TextResizeHandle } from "./textTransform";
import { NativeInputGate, type NativeInputOwner } from "./nativeInputGate";
import { isTextObjectInteractive, wrapTextLines } from "./textLayout";
import { calculatePickerPosition } from "./pickerGeometry";
import { useCommittedImageAction } from "../hooks/useCommittedImageAction";
import { useOverlayPreferences } from "../hooks/useOverlayPreferences";
import { useOverlayToolbarLayout } from "../hooks/useOverlayToolbarLayout";
import { useObjectHistoryController } from "../hooks/useObjectHistoryController";
import {
  annotationBounds,
  annotationSolidColor,
  cloneRasterAnnotations,
  convertFrameAnnotation,
  isFrameAnnotationKind,
  isPaintableAnnotation,
  resizeAnnotation,
  translateAnnotation,
  type RasterAnnotation,
  type SceneBounds,
} from "./annotationScene";
import { renderRasterOverlay } from "./annotationRenderer";
import { renderWhiteboardScene } from "./sceneRenderer";
import {
  appendNumberObject,
  clampNumberCenter,
  isNumberObjectInteractive,
  type NumberObject,
} from "./numberObjects";
import {
  advanceWindowSelectionDragMode,
  findWindowCandidate,
  type WindowSelectionDragMode,
} from "./windowCandidates";
import {
  annotationFromGesture,
  type ActiveAnnotationGesture,
  type RasterGestureSettings,
} from "../hooks/annotationGestureController";
import { formatPickerColor, type PickerSample } from "./pickerColor";
import {
  useAnnotationController,
  visualToolFor,
} from "../hooks/useAnnotationController";
import {
  cloneSceneElements,
  bindingAtPoint,
  deleteSceneSelection,
  duplicateSceneSelection,
  expandGroupSelection,
  elementGroupId,
  elementsInsideSelection,
  groupElements,
  moveSceneLayer,
  resizeSceneSelection,
  resolveSceneBindings,
  rotateSceneSelection,
  selectionBounds as getSceneSelectionBounds,
  translateSceneElement,
  sceneElementContains,
  sceneElement,
  snapDelta,
  ungroupElements,
  type LayerMove,
  type SceneElement,
  type SnapGuide,
} from "./whiteboardScene";

const loadExcalidrawEditor = () => import("./ExcalidrawScreenshotEditor");
const ExcalidrawScreenshotEditor = lazy(loadExcalidrawEditor);

const MIN_SIZE = 8;
let lastConfirmedSelection: Selection | null = null;

interface NativeCanvasPoint {
  clientX: number;
  clientY: number;
  pressure?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  detail?: number;
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
  const overlayLabel = getCurrentWindow().label;
  const bgRef = useRef<HTMLCanvasElement>(null);
  const shotRef = useRef<HTMLCanvasElement>(null);
  const excalidrawEditorRef = useRef<ExcalidrawScreenshotEditorHandle>(null);
  const shotBaseRef = useRef<HTMLCanvasElement | null>(null);
  const shotViewportRef = useRef<HTMLDivElement>(null);
  const fullImageRef = useRef<HTMLImageElement | null>(null);
  const colorSampleCanvas = useRef<HTMLCanvasElement | null>(null);
  const pickerZoomRef = useRef<HTMLCanvasElement>(null);
  const origin = useRef({ x: 0, y: 0 });
  const pendingWindowSelection = useRef<Selection | null>(null);
  const pendingWindowCandidateIdRef = useRef<string | null>(null);
  const captureGenerationRef = useRef(0);
  const backgroundMoveFrame = useRef<number | null>(null);
  const pendingBackgroundPoint = useRef<NativeCanvasPoint | null>(null);
  const draggingRef = useRef(false);
  const selectionPointerIdRef = useRef<number | null>(null);
  const windowSelectionDragModeRef = useRef<WindowSelectionDragMode>("manual");
  const annotationGestureRef = useRef<ActiveAnnotationGesture | null>(null);
  const linearCreationRef = useRef<ActiveAnnotationGesture | null>(null);
  const annotationPreviewFrame = useRef<number | null>(null);
  const annotationPreviewScale = useRef(1);
  const pickerSampleFrame = useRef<number | null>(null);
  const pendingPickerPoint = useRef<NativeCanvasPoint | null>(null);
  const nativeInputGateRef = useRef(new NativeInputGate());
  const nativeCanvasHandlersRef = useRef<NativeCanvasHandlers | null>(null);
  const pendingAction = useRef(0);
  const qrRequest = useRef(new RequestGeneration());
  // 递增令牌使得选区变化、关闭或新截图后的迟到 OCR 结果立即失效。
  const imageScaleRef = useRef({ scaleX: 1, scaleY: 1 });
  const lastTextFontSize = useRef<TextSize>(TEXT_SIZES[1]);
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
  const sceneClipboardRef = useRef<SceneElement[]>([]);
  const marqueeRef = useRef<{
    pointerId: number;
    start: { x: number; y: number };
    baseline: string[];
  } | null>(null);
  const eraserRef = useRef<{
    pointerId: number;
    baseline: SceneElement[];
    deleted: Set<string>;
  } | null>(null);
  const sceneTransformRef = useRef<{
    pointerId: number;
    mode: "move" | "rotate" | ResizeHandle;
    startX: number;
    startY: number;
    baseline: SceneElement[];
    selectedIds: Set<string>;
    bounds: SceneBounds;
    changed: boolean;
  } | null>(null);
  const linearNodeRef = useRef<{
    pointerId: number;
    id: string;
    index: number;
    origin: RasterAnnotation;
    changed: boolean;
  } | null>(null);
  const regionDragRef = useRef<
    | ({
        handle: ResizeHandle | "move";
        startX: number;
        startY: number;
        origin: Selection;
      } & SelectionRecropBaseline)
    | null
  >(null);

  const [dragging, setDragging] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [editorStatus, setEditorStatus] = useState<ExcalidrawEditorStatus>("loading");
  const [editorSelection, setEditorSelection] = useState<ExcalidrawSelectionState>({
    tool: null,
    tools: [],
    count: 0,
  });
  const [windowCandidates, setWindowCandidates] = useState<WindowCandidate[]>([]);
  const [hoveredWindow, setHoveredWindow] = useState<Selection | null>(null);
  const {
    phase,
    busy,
    shotReady,
    error,
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
  const handleEditorReady = useCallback(() => {
    setEditorReady(true);
    setEditorStatus("ready");
  }, []);
  const handleEditorSelectionChange = useCallback((next: ExcalidrawSelectionState) => {
    setEditorSelection((previous) =>
      isSameExcalidrawSelection(previous, next) ? previous : next,
    );
  }, []);
  const handleEditorError = useCallback((message: string) => {
    setEditorReady(false);
    setEditorStatus("failed");
    setError(`${message}；仍可复制、保存或贴出未标注的原始截图`);
  }, [setError]);
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
    sceneElements,
    setSceneElements,
    selectedIds,
    setSelectedIds,
    resetScene,
  } = useEditorSceneState();
  const { visuals, updateVisual, updateSharedColor } = useAnnotationController();
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [shapeKind, setShapeKind] = useState<FrameShape>("rect");
  const [fillStyle, setFillStyle] = useState<FillStyle>("none");
  const [fillColor, setFillColor] = useState("#ffc9c9");
  const [roughness, setRoughness] = useState<Roughness>(0);
  const [roundness, setRoundness] = useState<ToolSettings["roundness"]>("round");
  const [opacity, setOpacity] = useState(100);
  const [startArrowhead, setStartArrowhead] = useState<Arrowhead>("none");
  const [endArrowhead, setEndArrowhead] = useState<Arrowhead>("arrow");
  const [continuousDraw, setContinuousDraw] = useState(false);
  const [marquee, setMarquee] = useState<SceneBounds | null>(null);
  const [bindingTargetId, setBindingTargetId] = useState<string | null>(null);
  const [linearEditId, setLinearEditId] = useState<string | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [penWidth, setPenWidth] = useState(2);
  const [penPressure, setPenPressure] = useState(true);
  const [highlightWidth, setHighlightWidth] = useState(20);
  const [highlightOpacity, setHighlightOpacity] = useState(0.32);
  const [mosaicBlock, setMosaicBlock] = useState(12);
  const [textStyle, setTextStyle] = useState(DEFAULT_TEXT_STYLE);
  const [numberStyle, setNumberStyle] = useState(DEFAULT_NUMBER_STYLE);
  const [outlineStyle, setOutlineStyle] = useState<AnnotationOutlineConfig>({
    enabled: true,
    color: "#ffffff",
    width: 1,
  });
  const [adjustingRegion, setAdjustingRegion] = useState(false);
  const [pickerSample, setPickerSample] = useState<PickerSample | null>(null);
  const [pickerCopied, setPickerCopied] = useState(false);
  const [aspectPreset, setAspectPreset] = useState<AspectPreset>("free");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio | null>(null);
  const [qrContents, setQrContents] = useState<string[] | null>(null);
  const [ocrCopyState, setOcrCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const ocrCopyResetTimer = useRef<number | null>(null);
  const [arrowStyle, setArrowStyle] = useState<ArrowStyle>("straight");
  const activeVisual = visuals[visualToolFor(tool) ?? "frame"];
  const lineStyle = "lineStyle" in activeVisual ? activeVisual.lineStyle : DEFAULT_LINE_STYLE;
  const [arrowLabelEditor, setArrowLabelEditor] = useState<{
    id: string;
    original: string;
    isNew: boolean;
  } | null>(null);
  const [arrowLabelDraft, setArrowLabelDraft] = useState("");
  const {
    primaryRef: primaryToolbarRef,
    secondaryRef: secondaryToolbarRef,
    viewportSize,
    primarySize: primaryToolbarSize,
    secondarySize: secondaryToolbarSize,
    compact: compactToolbar,
    popupOpen: toolbarPopupOpen,
    reportPopup: reportToolbarPopup,
    closePopups: closeToolbarPopups,
  } = useOverlayToolbarLayout(
    phase === "editing",
    tool === "select" ? editorSelection.tool : tool,
  );

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

  useEffect(() => {
    const timer = window.setTimeout(() => void loadExcalidrawEditor(), 250);
    return () => window.clearTimeout(timer);
  }, []);

  const {
    stateRef: objectStateRef,
    mutationRef: objectMutationRef,
    styleChangedRef: objectStyleChangedRef,
    canUndo,
    canRedo,
    resetHistory,
    captureSnapshot: captureObjectSnapshot,
    beginMutation: beginObjectMutation,
    commitMutation: commitObjectMutation,
    cancelMutation: cancelObjectMutation,
    pushCurrent: pushCurrentObjects,
    undo,
    redo,
  } = useObjectHistoryController({
    rasterAnnotations,
    textObjects,
    numberObjects,
    sceneElements,
    setRasterAnnotations,
    setTextObjects,
    setNumberObjects,
    setSceneElements,
    clearRasterPreview: () => setRasterPreview(null),
    clearTransientSelection: () => {
      setTextEditor(null);
      setTextDraft("");
      setArrowLabelEditor(null);
      setArrowLabelDraft("");
      setSelectedTextId(null);
      setSelectedNumberId(null);
      setSelectedRasterId(null);
    },
    gestureRef: annotationGestureRef,
    resetNativeInput: () => nativeInputGateRef.current.reset(),
  });

  const commitArrowLabel = useCallback(() => {
    if (!arrowLabelEditor) return;
    const draft = arrowLabelDraft.trim();
    if (!draft) {
      if (arrowLabelEditor.isNew) undo();
      setArrowLabelEditor(null);
      setArrowLabelDraft("");
      return;
    }
    if (!arrowLabelEditor.isNew && draft !== arrowLabelEditor.original) pushCurrentObjects();
    setRasterAnnotations((items) =>
      items.map((item) =>
        item.id === arrowLabelEditor.id
          ? { ...item, style: { ...item.style, arrowLabel: draft } }
          : item,
      ),
    );
    setArrowLabelEditor(null);
    setArrowLabelDraft("");
  }, [arrowLabelDraft, arrowLabelEditor, pushCurrentObjects, undo]);

  const cancelArrowLabel = useCallback(() => {
    if (arrowLabelEditor?.isNew) undo();
    setArrowLabelEditor(null);
    setArrowLabelDraft("");
  }, [arrowLabelEditor, undo]);

  useEffect(() => {
    qrRequest.current.cancel();
    setQrContents(null);
  }, [selection?.x, selection?.y, selection?.width, selection?.height]);

  useEffect(() => {
    if (phase !== "editing") {
      clearArrowRenderCache();
      setArrowLabelEditor(null);
      setArrowLabelDraft("");
    }
  }, [phase]);

  useEffect(
    () => () => {
      clearArrowRenderCache();
    },
    [],
  );

  useEffect(() => {
    const gesture = annotationGestureRef.current;
    if (gesture) {
      if (annotationPreviewFrame.current !== null)
        cancelAnimationFrame(annotationPreviewFrame.current);
      annotationPreviewFrame.current = null;
      annotationGestureRef.current = null;
      setRasterPreview(null);
    }
    linearCreationRef.current = null;
    if (pickerSampleFrame.current !== null) cancelAnimationFrame(pickerSampleFrame.current);
    pickerSampleFrame.current = null;
    pendingPickerPoint.current = null;
    if (tool !== "picker") setPickerSample(null);
    nativeInputGateRef.current.reset();
  }, [tool, selection?.x, selection?.y, selection?.width, selection?.height]);

  const reportPrimaryPopup = useCallback(
    (open: boolean) => reportToolbarPopup("primary", open),
    [reportToolbarPopup],
  );
  const {
    palette,
    paletteBusy,
    pickerFormat,
    annotationStyles,
    captureSizeUnit,
    configSaving: screenshotConfigSaving,
    reloadPalette: loadPalette,
    mutatePalette,
    updateConfig: updateScreenshotConfig,
    updateAnnotationStyles,
  } = useOverlayPreferences({ onError: setError });

  useEffect(() => {
    const sharedColor = annotationStyles.shape.stroke_color;
    updateSharedColor(sharedColor);
    updateVisual("frame", { lineStyle: annotationStyles.shape.stroke_style });
    updateVisual("line", { lineStyle: annotationStyles.line.stroke_style });
    updateVisual("arrow", { lineStyle: annotationStyles.arrow.stroke_style });
    updateVisual("pen", { lineStyle: annotationStyles.pen.stroke_style });
    updateVisual("highlight", { color: annotationStyles.highlight.stroke_color, lineStyle: annotationStyles.highlight.stroke_style });
    setTextStyle((current) => ({
      ...current,
      color: sharedColor,
      fontSize: annotationStyles.text.font_size,
    }));
    setArrowStyle(annotationStyles.arrow.arrow_type);
    setStartArrowhead(annotationStyles.arrow.start_arrowhead);
    setEndArrowhead(annotationStyles.arrow.end_arrowhead);
    setPenWidth(normalizeExcalidrawStrokeWidth(annotationStyles.pen.stroke_width));
    setPenPressure(annotationStyles.pen.pressure);
    setHighlightWidth(annotationStyles.highlight.stroke_width);
    setHighlightOpacity(annotationStyles.highlight.opacity);
    setMosaicBlock(annotationStyles.mosaic.block_size);
  }, [annotationStyles, updateSharedColor, updateVisual]);

  useEffect(() => {
    const key = isFrameAnnotationKind(tool) ? "shape"
      : tool === "line" || tool === "arrow" || tool === "pen" || tool === "highlight" || tool === "text" || tool === "number" || tool === "mosaic"
        ? tool : null;
    if (!key) return;
    const style = annotationStyles[key];
    setStrokeWidth(normalizeExcalidrawStrokeWidth(style.stroke_width));
    setFillStyle(style.fill_style);
    setFillColor(style.background_color);
    setRoughness(style.roughness);
    setOpacity(Math.round(style.opacity * 100));
    setOutlineStyle({
      enabled: style.outline_enabled,
      color: style.outline_color,
      width: style.outline_width,
    });
  }, [annotationStyles, tool]);

  const selectedRasterForTool = rasterAnnotations.find((item) => item.id === selectedRasterId);
  const selectedRasterMatchesTool = Boolean(
    selectedRasterForTool &&
      (tool === "select" || selectedRasterForTool.kind === tool ||
        (isFrameAnnotationKind(selectedRasterForTool.kind) && isFrameAnnotationKind(tool))),
  );
  const strokeColor =
    selectedRasterForTool && selectedRasterMatchesTool
      ? annotationSolidColor(selectedRasterForTool.style)
      : visuals.frame.color;
  const selectedTextForTool =
    tool === "text" || tool === "select" ? textObjects.find((item) => item.id === selectedTextId) : undefined;
  const selectedNumberForTool =
    tool === "number" || tool === "select" ? numberObjects.find((item) => item.id === selectedNumberId) : undefined;
  const canvasScale =
    (shotRef.current?.width ?? 1) /
    Math.max(1, selection?.width ?? shotRef.current?.width ?? 1);
  const activeOutline = selectedRasterForTool && selectedRasterMatchesTool
    ? {
        ...selectedRasterForTool.style.outline,
        width: selectedRasterForTool.style.outline.width / canvasScale,
      }
    : selectedTextForTool
      ? {
          enabled: selectedTextForTool.strokeWidth > 0,
          color: selectedTextForTool.strokeColor,
          width: selectedTextForTool.strokeWidth,
        }
      : selectedNumberForTool
        ? selectedNumberForTool.style.outline
        : outlineStyle;

  useEffect(() => {
    if (phase === "capturing") {
      setAspectPreset("free");
      setAspectRatio(null);
    }
  }, [phase]);

  const copyPickerSample = useCallback(
    async (sample: PickerSample) => {
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
    },
    [mutatePalette, pickerFormat, setError],
  );

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

  const copyPaletteColor = useCallback(
    async (color: string) => {
      try {
        const copied = await window.api.copyText(color);
        if (!copied) throw new Error("剪贴板未接受颜色文本");
      } catch (cause) {
        setError(`颜色复制失败：${cause instanceof Error ? cause.message : String(cause)}`);
        return;
      }
      await mutatePalette(() => paletteApi.record(color), "最近颜色保存失败");
    },
    [mutatePalette, setError],
  );

  const setPaletteFavorite = useCallback(
    async (color: string, favorite: boolean) => {
      await mutatePalette(
        () => paletteApi.favorite(color, favorite),
        favorite ? "颜色收藏失败" : "取消收藏失败",
      );
    },
    [mutatePalette],
  );

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
  const canAdjustRegion = phase === "editing" && shotReady && !busy
    && (!tool || (tool === "select" && selectedIds.length === 0));
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
        phase === "selecting"
          ? SELECTION_SIZE_BADGE_SIZE
          : aspectPreset === "custom"
            ? SELECTION_SIZE_CUSTOM_PANEL_SIZE
            : SELECTION_SIZE_PANEL_SIZE,
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
    if (editorReady && excalidrawEditorRef.current)
      return excalidrawEditorRef.current.exportPng();
    const canvas = shotRef.current;
    if (!canvas) throw new Error("No canvas");

    // A failed editor initialization must not make the capture unusable.
    // The visible canvas is the untouched physical-pixel crop in this state.
    if (editorStatus === "loading") throw new Error("标注编辑器仍在加载，请稍候");
    if (editorStatus === "failed") {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error("toBlob failed"))),
          "image/png",
        );
      });
      return new Uint8Array(await blob.arrayBuffer());
    }

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.imageSmoothingEnabled = false;
    const base = shotBaseRef.current;
    if (!base) throw new Error("Screenshot base is unavailable");
    // Export must regenerate RoughJS drawables from the immutable scene so the
    // saved PNG cannot reuse a stale preview cache entry.
    clearArrowRenderCache();
    renderWhiteboardScene(
      ctx,
      base,
      sceneElements,
      canvas.width / Math.max(1, selection?.width ?? canvas.width),
      true,
    );

    const blob = await new Promise<Blob>((resolve, reject) => {
      exportCanvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/png",
      );
    });
    return new Uint8Array(await blob.arrayBuffer());
  }, [editorReady, editorStatus, sceneElements, selection?.width]);

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
  });

  const runOcr = useCallback(() => {
    setOcrCopyState("idle");
    recognizeSelection();
  }, [recognizeSelection]);

  const closeOcr = useCallback(() => {
    dismissOcr();
    setOcrCopyState("idle");
  }, [dismissOcr]);

  const copyOcrResult = useCallback(async () => {
    const text = ocrPanel.result?.text.trim();
    if (!text) return;
    if (ocrCopyResetTimer.current !== null) window.clearTimeout(ocrCopyResetTimer.current);
    try {
      const copied = await window.api.copyText(ocrPanel.result!.text);
      if (!copied) throw new Error("clipboard rejected OCR text");
      setOcrCopyState("copied");
    } catch {
      setOcrCopyState("failed");
    }
    ocrCopyResetTimer.current = window.setTimeout(() => {
      setOcrCopyState("idle");
      ocrCopyResetTimer.current = null;
    }, 1400);
  }, [ocrPanel.result]);

  useEffect(() => () => {
    if (ocrCopyResetTimer.current !== null) window.clearTimeout(ocrCopyResetTimer.current);
  }, []);

  useEffect(() => {
    dismissOcr();
    setOcrCopyState("idle");
  }, [dismissOcr, selection?.x, selection?.y, selection?.width, selection?.height]);

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
        const id = textEditor.id ?? `text-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const previous = objectStateRef.current.textObjects.find((item) => item.id === id);
        const next: TextObject = {
          id,
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
          textAlign: textEditor.textAlign,
          opacity: textEditor.opacity,
          bold: textEditor.bold,
          strokeColor: textEditor.strokeColor,
          strokeWidth: textEditor.strokeWidth,
          angle: previous?.angle ?? 0,
          groupId: previous?.groupId ?? null,
          version: (previous?.version ?? -1) + 1,
          seed: previous?.seed ?? Math.floor(Math.random() * 0x7fffffff),
          containerId: textEditor.containerId ?? previous?.containerId ?? null,
        };
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
        setSelectedIds([next.id], next.id);
        if (!continuousDraw && !textEditor.id) setTool("select");
      }
      setTextEditor(null);
      setTextDraft("");
    },
    [continuousDraw, textEditor, screenToCanvas, pushCurrentObjects, setSelectedIds, setTool],
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
        textAlign: obj.textAlign,
        opacity: obj.opacity,
        bold: obj.bold,
        strokeColor: obj.strokeColor,
        strokeWidth: obj.strokeWidth,
      });
      lastTextFontSize.current = nearestTextSize(obj.fontSize);
      setTextStyle({
        fontSize: nearestTextSize(obj.fontSize * obj.transformScale),
        color: obj.color,
        font: obj.font,
        textAlign: obj.textAlign,
        opacity: obj.opacity,
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
    const loadCapture = async (): Promise<void> => {
      const current = ++revision;
      try {
        const shot = await window.api.getFullScreenshot(overlayLabel);
        if (shot.overlayLabel !== overlayLabel) return;
        if (cancelled || current !== revision) return;
        if (captureGenerationRef.current === shot.generation && fullImageRef.current) return;
        captureGenerationRef.current = shot.generation;
        setEditorReady(false);
        setEditorStatus("loading");
        setEditorSelection({ tool: null, tools: [], count: 0 });
        const img = await loadImageFromUrl(shot.url);
        if (cancelled || current !== revision) return;
        void loadPalette();
        beginCapture();
        draggingRef.current = false;
        selectionPointerIdRef.current = null;
        windowSelectionDragModeRef.current = "manual";
        pendingWindowSelection.current = null;
        pendingWindowCandidateIdRef.current = null;
        pendingBackgroundPoint.current = null;
        setDragging(false);
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
      setEditorReady(false);
      setEditorStatus("loading");
      resetScene();
      setTool("select");
      sceneClipboardRef.current = [];
      linearCreationRef.current = null;
      marqueeRef.current = null;
      eraserRef.current = null;
      sceneTransformRef.current = null;
      linearNodeRef.current = null;
      setActiveGroupId(null);
      setSnapGuides([]);
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
        // Excalidraw is a transparent annotation layer. Keep the immutable
        // crop on the visible canvas underneath it instead of clearing the
        // only on-screen copy of the screenshot.
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(base, 0, 0);
        resetHistory();
        setShotReady(true);
        setError(null);
      });
    },
    [beginEditing, cancelObjectMutation, paintBackground, resetHistory, resetScene, setSelection],
  );

  useLayoutEffect(() => {
    // The legacy canvas input path is retained only as a degraded fallback.
    // A healthy Excalidraw session owns all pointer interaction and must not
    // pay for the duplicate window-level listener set.
    if (phase !== "editing" || editorStatus !== "failed") return;
    const canvas = shotRef.current;
    const base = shotBaseRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !base || !context) return;
    const scale = canvas.width / Math.max(1, selection?.width ?? canvas.width);
    try {
      const visible = textEditor?.id
        ? sceneElements.filter((element) => element.id !== textEditor.id)
        : sceneElements;
      renderWhiteboardScene(
        context,
        base,
        rasterPreview ? [...visible, sceneElement(rasterPreview)] : visible,
        scale,
        false,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "标注效果渲染失败，请重试");
    }
  }, [editorStatus, phase, rasterPreview, sceneElements, selection?.width, setError, textEditor?.id]);

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
      try {
        renderRasterOverlay(
          ctx,
          base,
          translatedRaster,
          crop.outputWidth / Math.max(1, next.width),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "标注效果渲染失败，请重试");
      }

      setTextObjects(
        baseline.baseTextObjects.map((item) => {
          const point = mapCropPoint({ x: item.canvasX, y: item.canvasY }, baseline.baseCrop, crop);
          return { ...item, canvasX: point.x, canvasY: point.y };
        }),
      );
      setNumberObjects(
        baseline.baseNumberObjects.map((item) => {
          const point = mapCropPoint({ x: item.canvasX, y: item.canvasY }, baseline.baseCrop, crop);
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
    blocked: Boolean(textEditor) || Boolean(arrowLabelEditor) || Boolean(linearEditId) || Boolean(linearCreationRef.current) || toolbarPopupOpen,
    tool,
    phase,
    hasSelectedText: Boolean(selectedTextId),
    hasSelectedNumber: Boolean(selectedNumberId),
    hasSelectedRaster: Boolean(selectedRasterId),
    shotReady,
    busy,
    editorActive: editorReady,
    hasEditorSelection: editorSelection.count > 0,
    isEditingText: () => excalidrawEditorRef.current?.isEditingText() ?? false,
    dismissTransientPanel: () => {
      if (ocrRunning || ocrPanel.result || ocrPanel.error) {
        closeOcr();
        return true;
      }
      return false;
    },
    copyPickerHex: () => void copyPickerHex(),
    exitPicker: () => {
      setTool(null);
      setPickerSample(null);
    },
    clearSelection: () => {
      setSelectedIds([]);
    },
    returnToSelect: () => {
      setTool("select");
      excalidrawEditorRef.current?.setTool("select");
    },
    deleteSelection: () => {
      if (!selectedIds.length) return;
      pushCurrentObjects();
      setSceneElements((previous) => deleteSceneSelection(previous, new Set(selectedIds)));
      setSelectedIds([]);
    },
    cancel: cancelOverlay,
    undo,
    redo,
    confirm: () => {
      void runCommittedImageAction(window.api.copyImage, "复制截图失败");
    },
  });

  useEffect(() => {
    if (!linearEditId) return;
    const finish = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setLinearEditId(null);
    };
    window.addEventListener("keydown", finish, true);
    return () => window.removeEventListener("keydown", finish, true);
  }, [linearEditId]);

  useEffect(() => {
    if (!activeGroupId) return;
    const exitGroup = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setActiveGroupId(null);
      setSelectedIds([]);
    };
    window.addEventListener("keydown", exitGroup, true);
    return () => window.removeEventListener("keydown", exitGroup, true);
  }, [activeGroupId, setSelectedIds]);

  useEffect(() => {
    if (!linearCreationRef.current) return;
    const finishLinear = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const gesture = linearCreationRef.current;
      linearCreationRef.current = null;
      setRasterPreview(null);
      if (event.key === "Escape" || !gesture || gesture.points.length < 2) return;
      const canvas = shotRef.current;
      const scale = canvas ? canvas.width / Math.max(1, selection?.width ?? canvas.width) : 1;
      const preview = annotationFromGesture({ ...gesture, changed: true, multiClick: true }, scale);
      const committed = {
        ...preview,
        startBinding: gesture.disableBinding ? null : bindingAtPoint(sceneElements, preview.points[0], preview.id),
        endBinding: gesture.disableBinding ? null : bindingAtPoint(sceneElements, preview.points[preview.points.length - 1], preview.id),
      };
      pushCurrentObjects();
      setRasterAnnotations((previous) => [...previous, committed]);
      setSelectedIds([committed.id], committed.id);
      if (!continuousDraw) setTool("select");
    };
    window.addEventListener("keydown", finishLinear, true);
    return () => window.removeEventListener("keydown", finishLinear, true);
  }, [continuousDraw, pushCurrentObjects, rasterPreview, sceneElements, selection?.width, setSelectedIds, setTool]);

  useEffect(() => {
    const editingField = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null;
      return Boolean(element?.closest("input, textarea, [contenteditable='true']"));
    };
    const selectedSet = () => new Set(selectedIds);
    const freshId = (source: string) =>
      `${source}-copy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const duplicate = (source: SceneElement[]): void => {
      if (!source.length) return;
      const chosen = new Set(source.map((element) => element.id));
      const result = duplicateSceneSelection(source, chosen, freshId, 16);
      const copies = result.elements.slice(source.length);
      pushCurrentObjects();
      setSceneElements((previous) => [...previous, ...copies]);
      setSelectedIds([...result.selectedIds]);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (phase !== "editing" || editingField(event.target) || toolbarPopupOpen) return;
      const command = event.ctrlKey || event.metaKey;
      if (!command) {
        if (event.key.toLowerCase() === "v") setTool("select");
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "a") {
        event.preventDefault();
        setSelectedIds(sceneElements.map((element) => element.id));
        setTool("select");
      } else if (key === "c" && selectedIds.length) {
        event.preventDefault();
        sceneClipboardRef.current = cloneSceneElements(
          sceneElements.filter((element) => selectedSet().has(element.id)),
        );
      } else if (key === "v" && sceneClipboardRef.current.length) {
        event.preventDefault();
        duplicate(cloneSceneElements(sceneClipboardRef.current));
        setTool("select");
      } else if (key === "d" && selectedIds.length) {
        event.preventDefault();
        duplicate(sceneElements.filter((element) => selectedSet().has(element.id)));
        setTool("select");
      } else if (key === "g" && selectedIds.length > 1) {
        event.preventDefault();
        pushCurrentObjects();
        setSceneElements((previous) => event.shiftKey
          ? ungroupElements(previous, selectedSet())
          : groupElements(previous, selectedSet(), `group-${Date.now()}`));
      } else if ((event.key === "]" || event.key === "[") && selectedIds.length) {
        event.preventDefault();
        const move: LayerMove = event.key === "]"
          ? (event.shiftKey ? "front" : "forward")
          : (event.shiftKey ? "back" : "backward");
        pushCurrentObjects();
        setSceneElements((previous) => moveSceneLayer(previous, selectedSet(), move));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, pushCurrentObjects, sceneElements, selectedIds, setSceneElements, setSelectedIds, setTool, toolbarPopupOpen]);

  useEffect(() => {
    let pendingMove: PointerEvent | null = null;
    let moveFrame = 0;
    const processMove = (event: PointerEvent): void => {
      const canvas = shotRef.current;
      if (!canvas || !selection) return;
      const scaleX = canvas.width / Math.max(1, selection.width);
      const scaleY = canvas.height / Math.max(1, selection.height);

      const linearNode = linearNodeRef.current;
      if (linearNode && linearNode.pointerId === event.pointerId) {
        const canvasPoint = screenToCanvas(event.clientX, event.clientY);
        const point = { x: canvasPoint.canvasX, y: canvasPoint.canvasY };
        const points = linearNode.origin.points.map((item, index) => index === linearNode.index
          ? { ...item, ...point } : { ...item });
        const endpoint = linearNode.index === 0 || linearNode.index === points.length - 1;
        const binding = endpoint && !event.ctrlKey
          ? bindingAtPoint(objectStateRef.current.elements, point, linearNode.id)
          : null;
        const next = {
          ...linearNode.origin,
          points,
          startBinding: linearNode.index === 0 ? binding : linearNode.origin.startBinding,
          endBinding: linearNode.index === points.length - 1 ? binding : linearNode.origin.endBinding,
          version: (linearNode.origin.version ?? 0) + 1,
        };
        linearNode.changed = true;
        setRasterAnnotations((previous) => previous.map((item) => item.id === linearNode.id ? next : item));
        setBindingTargetId(binding?.elementId ?? null);
        return;
      }

      const sceneTransform = sceneTransformRef.current;
      if (sceneTransform && sceneTransform.pointerId === event.pointerId) {
        const dx = (event.clientX - sceneTransform.startX) * scaleX;
        const dy = (event.clientY - sceneTransform.startY) * scaleY;
        let next: SceneElement[];
        if (sceneTransform.mode === "move") {
          const moving = { ...sceneTransform.bounds, x: sceneTransform.bounds.x + dx, y: sceneTransform.bounds.y + dy };
          const snap = snapDelta(
            moving,
            sceneTransform.baseline.filter((element) => !sceneTransform.selectedIds.has(element.id)),
            canvas,
            6 * Math.max(scaleX, scaleY),
          );
          setSnapGuides(snap.guides);
          next = sceneTransform.baseline.map((element) => sceneTransform.selectedIds.has(element.id)
            ? translateSceneElement(element, dx + snap.dx, dy + snap.dy) : element);
        } else if (sceneTransform.mode === "rotate") {
          setSnapGuides([]);
          const center = {
            x: sceneTransform.bounds.x + sceneTransform.bounds.width / 2,
            y: sceneTransform.bounds.y + sceneTransform.bounds.height / 2,
          };
          const start = Math.atan2(
            sceneTransform.startY - (selection.y + center.y / scaleY),
            sceneTransform.startX - (selection.x + center.x / scaleX),
          );
          const current = Math.atan2(
            event.clientY - (selection.y + center.y / scaleY),
            event.clientX - (selection.x + center.x / scaleX),
          );
          let delta = current - start;
          if (event.shiftKey) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12);
          next = rotateSceneSelection(sceneTransform.baseline, sceneTransform.selectedIds, center, delta);
        } else {
          setSnapGuides([]);
          let bounds = resizeRect(sceneTransform.bounds, sceneTransform.mode, dx, dy, canvas.width, canvas.height);
          if (event.shiftKey) {
            const ratio = sceneTransform.bounds.width / Math.max(1, sceneTransform.bounds.height);
            bounds = { ...bounds, height: bounds.width / Math.max(0.001, ratio) };
          }
          if (event.altKey) {
            const centerX = sceneTransform.bounds.x + sceneTransform.bounds.width / 2;
            const centerY = sceneTransform.bounds.y + sceneTransform.bounds.height / 2;
            bounds = { x: centerX - bounds.width / 2, y: centerY - bounds.height / 2, width: bounds.width, height: bounds.height };
          }
          next = resizeSceneSelection(sceneTransform.baseline, sceneTransform.selectedIds, sceneTransform.bounds, bounds);
        }
        sceneTransform.changed = Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1;
        setSceneElements(resolveSceneBindings(next));
        return;
      }

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
      if (linearNodeRef.current?.pointerId === event.pointerId) {
        const changed = linearNodeRef.current.changed;
        linearNodeRef.current = null;
        setBindingTargetId(null);
        commitObjectMutation(changed);
      }
      if (sceneTransformRef.current?.pointerId === event.pointerId) {
        const changed = sceneTransformRef.current.changed;
        sceneTransformRef.current = null;
        setSnapGuides([]);
        commitObjectMutation(changed);
      }
      if (rasterTransformRef.current?.pointerId === event.pointerId) {
        const changed = rasterTransformRef.current.changed;
        rasterTransformRef.current = null;
        if (changed) setSceneElements((previous) => resolveSceneBindings(previous));
        commitObjectMutation(changed);
      }
      if (textDragRef.current?.pointerId === event.pointerId) {
        const changed = textDragRef.current.changed;
        textDragRef.current = null;
        if (changed) setSceneElements((previous) => resolveSceneBindings(previous));
        commitObjectMutation(changed);
      }
      if (textResizeRef.current?.pointerId === event.pointerId) {
        const changed = textResizeRef.current.changed;
        textResizeRef.current = null;
        if (changed) setSceneElements((previous) => resolveSceneBindings(previous));
        commitObjectMutation(changed);
      }
      textEditorDragRef.current = null;
      if (numberDragRef.current?.pointerId === event.pointerId) {
        const changed = numberDragRef.current.changed;
        numberDragRef.current = null;
        if (changed) setSceneElements((previous) => resolveSceneBindings(previous));
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

  const reportSelectionTrace = useCallback(
    (
      stage: CaptureSelectionTrace["stage"],
      point: { x: number; y: number },
      currentSelection: Selection | null,
      candidateId: string | null,
      dragMode: WindowSelectionDragMode,
    ) => {
      const generation = captureGenerationRef.current;
      if (!generation) return;
      const trace: CaptureSelectionTrace = {
        stage,
        pointerX: point.x,
        pointerY: point.y,
        selection: currentSelection ? { ...currentSelection } : null,
        candidateId,
        dragMode,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      };
      void window.api.reportCaptureRendered(generation, overlayLabel, trace).catch((cause) => {
        console.warn("截图区域诊断日志写入失败", cause);
      });
    },
    [overlayLabel],
  );

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

    const previousMode = windowSelectionDragModeRef.current;
    windowSelectionDragModeRef.current = advanceWindowSelectionDragMode(
      previousMode,
      origin.current,
      point,
    );
    if (windowSelectionDragModeRef.current === "candidate" && pendingWindowSelection.current)
      return;
    const candidateId = pendingWindowCandidateIdRef.current;
    pendingWindowSelection.current = null;
    pendingWindowCandidateIdRef.current = null;
    const nextSelection =
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
        : clampSelection(normalizeRect(origin.current.x, origin.current.y, point.x, point.y));
    setSelection(nextSelection);
    if (previousMode === "candidate")
      reportSelectionTrace("manual-selection-start", point, nextSelection, candidateId, "manual");
  }, [aspectRatio, phase, reportSelectionTrace, setSelection, windowCandidates]);

  const onBgPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (phase !== "selecting" || busy || event.button !== 0) return;
      event.preventDefault();
      if (backgroundMoveFrame.current !== null) {
        cancelAnimationFrame(backgroundMoveFrame.current);
        backgroundMoveFrame.current = null;
      }
      pendingBackgroundPoint.current = null;
      event.currentTarget.setPointerCapture(event.pointerId);
      selectionPointerIdRef.current = event.pointerId;
      draggingRef.current = true;
      setDragging(true);
      const point = clampPoint(event.clientX, event.clientY);
      origin.current = point;
      const candidate = findWindowCandidate(windowCandidates, point.x, point.y);
      const candidateSelection = candidate
        ? { x: candidate.x, y: candidate.y, width: candidate.width, height: candidate.height }
        : null;
      pendingWindowSelection.current = candidateSelection;
      pendingWindowCandidateIdRef.current = candidate?.id ?? null;
      windowSelectionDragModeRef.current = candidateSelection ? "candidate" : "manual";
      setHoveredWindow(null);
      setSelection(candidateSelection ?? { x: point.x, y: point.y, width: 0, height: 0 });
      reportSelectionTrace(
        "pointer-down",
        point,
        candidateSelection,
        candidate?.id ?? null,
        windowSelectionDragModeRef.current,
      );
    },
    [busy, phase, reportSelectionTrace, setSelection, windowCandidates],
  );

  const onBgPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (
        draggingRef.current &&
        selectionPointerIdRef.current !== null &&
        event.pointerId !== selectionPointerIdRef.current
      )
        return;
      pendingBackgroundPoint.current = { clientX: event.clientX, clientY: event.clientY };
      if (backgroundMoveFrame.current === null) {
        backgroundMoveFrame.current = requestAnimationFrame(flushBackgroundMove);
      }
    },
    [flushBackgroundMove],
  );

  const onBgPointerUp = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (selectionPointerIdRef.current !== event.pointerId) return;
    pendingBackgroundPoint.current = { clientX: event.clientX, clientY: event.clientY };
    flushBackgroundMove();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    selectionPointerIdRef.current = null;
    const wasDragging = draggingRef.current;
    draggingRef.current = false;
    setDragging(false);
    if (!wasDragging || phase !== "selecting") return;
    const completedMode = windowSelectionDragModeRef.current;
    const completedCandidateId = pendingWindowCandidateIdRef.current;
    pendingWindowSelection.current = null;
    pendingWindowCandidateIdRef.current = null;
    windowSelectionDragModeRef.current = "manual";
    const current = selectionRef.current;
    reportSelectionTrace(
      "pointer-up",
      clampPoint(event.clientX, event.clientY),
      current,
      completedCandidateId,
      completedMode,
    );
    if (current && current.width >= MIN_SIZE && current.height >= MIN_SIZE) {
      enterEditMode(clampSelection(current));
    } else {
      setSelection(null);
    }
  }, [enterEditMode, flushBackgroundMove, phase, reportSelectionTrace, setSelection, selectionRef]);

  const onBgPointerCancel = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (selectionPointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    selectionPointerIdRef.current = null;
    draggingRef.current = false;
    pendingWindowSelection.current = null;
    pendingWindowCandidateIdRef.current = null;
    windowSelectionDragModeRef.current = "manual";
    pendingBackgroundPoint.current = null;
    setDragging(false);
    setSelection(null);
    setHoveredWindow(null);
  }, [setSelection]);

  const toLocal = (
    event: { clientX: number; clientY: number; pressure?: number },
  ): { x: number; y: number; pressure?: number } => {
    const canvas = shotRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) * canvas.width) / Math.max(1, bounds.width),
      y: ((event.clientY - bounds.top) * canvas.height) / Math.max(1, bounds.height),
      pressure: event.pressure,
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
          Math.floor(crop.sourceX + (point.x / canvas.width) * crop.sourceWidth),
        ),
      );
      const imageY = Math.max(
        0,
        Math.min(
          image.naturalHeight - 1,
          Math.floor(crop.sourceY + (point.y / canvas.height) * crop.sourceHeight),
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
      if (arrowLabelEditor) {
        commitArrowLabel();
        return false;
      }
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

      if (tool === "select") {
        const hit = [...objectStateRef.current.elements]
          .reverse()
          .find((element) => sceneElementContains(element, point));
        if (hit) {
          const hitGroup = elementGroupId(hit);
          const group = hitGroup && activeGroupId === hitGroup
            ? new Set([hit.id])
            : expandGroupSelection(objectStateRef.current.elements, new Set([hit.id]));
          setSelectedIds((current) => {
            if (!event.shiftKey) return [...group];
            const next = new Set(current);
            const removing = [...group].every((id) => next.has(id));
            group.forEach((id) => removing ? next.delete(id) : next.add(id));
            return [...next];
          }, hit.id);
          return false;
        }
        event.preventDefault();
        marqueeRef.current = {
          pointerId: owner.id,
          start: point,
          baseline: event.shiftKey ? [...selectedIds] : [],
        };
        setMarquee({ x: point.x, y: point.y, width: 0, height: 0 });
        if (!event.shiftKey) setSelectedIds([]);
        return true;
      }

      if (tool === "eraser") {
        event.preventDefault();
        const baseline = cloneSceneElements(objectStateRef.current.elements);
        const deleted = new Set<string>();
        const hit = [...baseline].reverse().find((element) => sceneElementContains(element, point));
        if (hit) expandGroupSelection(baseline, new Set([hit.id])).forEach((id) => deleted.add(id));
        eraserRef.current = { pointerId: owner.id, baseline, deleted };
        beginObjectMutation();
        if (deleted.size) setSceneElements(deleteSceneSelection(baseline, deleted));
        return true;
      }

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
          strokeColor: outlineStyle.color,
          strokeWidth: outlineStyle.enabled ? outlineStyle.width : 0,
        });
        setTextDraft("");
        return false;
      }

      if (tool === "number") {
        pushCurrentObjects();
        const id = `number-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNumberObjects((previous) => {
          const outlineWidth = outlineStyle.enabled ? outlineStyle.width * scale : 0;
          const radius = Math.max(12, (numberStyle.size * scale) / 2) + outlineWidth;
          const center = clampNumberCenter(point.x, point.y, radius, canvas.width, canvas.height);
          return appendNumberObject(previous, {
            id,
            ...center,
            style: { ...numberStyle, outline: { ...outlineStyle } },
            angle: 0,
            groupId: null,
            version: 0,
            seed: Math.floor(Math.random() * 0x7fffffff),
          });
        });
        setSelectedIds([id], id);
        if (!continuousDraw) setTool("select");
        return false;
      }

      if (!["rect", "ellipse", "diamond", "line", "arrow", "pen", "highlight", "mosaic"].includes(tool)) return false;
      event.preventDefault();
      const existingLinear = (tool === "line" || tool === "arrow")
        && linearCreationRef.current?.tool === tool
        ? linearCreationRef.current
        : null;
      const gesture: ActiveAnnotationGesture = {
        ...(existingLinear
          ? {
              ...existingLinear,
              pointerId: owner.id,
              points: [...existingLinear.points, point],
              changed: true,
              multiClick: true,
              completeOnFinish: (event.detail ?? 0) >= 2,
            }
          : createAnnotationGesture(
              owner.id,
              tool as RasterTool,
              point,
              cloneRasterAnnotations(objectStateRef.current.rasterAnnotations),
            )),
        id: `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        disableBinding: Boolean(event.ctrlKey),
        settings: {
          strokeColor,
          strokeWidth,
          outline: outlineStyle,
          lineStyle,
          fillStyle,
          fillColor,
          roughness,
          arrowStyle,
          startArrowhead,
          endArrowhead,
          penWidth,
          penPressure,
          highlightWidth,
          highlightOpacity,
          mosaicBlock,
          textStyle,
        },
      };
      if (existingLinear) gesture.id = existingLinear.id;
      annotationGestureRef.current = gesture;
      if (gesture.tool === "pen" || gesture.tool === "highlight")
        setRasterPreview(annotationFromGesture(gesture, scale));
      return true;
    },
    [
      phase,
      busy,
      tool,
      shotReady,
      selection,
      strokeColor,
      lineStyle,
      fillStyle,
      fillColor,
      roughness,
      strokeWidth,
      outlineStyle,
      arrowStyle,
      startArrowhead,
      endArrowhead,
      textStyle,
      numberStyle,
      pushCurrentObjects,
      penWidth,
      penPressure,
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
      arrowLabelEditor,
      commitArrowLabel,
      activeGroupId,
      continuousDraw,
    ],
  );

  const flushAnnotationPreview = useCallback(() => {
    annotationPreviewFrame.current = null;
    const gesture = annotationGestureRef.current;
    const canvas = shotRef.current;
    if (!gesture || !canvas) return;
    setRasterPreview(annotationFromGesture(gesture, annotationPreviewScale.current));
  }, []);

  const cancelAnnotationPreview = useCallback(() => {
    if (annotationPreviewFrame.current !== null)
      cancelAnimationFrame(annotationPreviewFrame.current);
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
      const point = toLocal(event);
      const marqueeGesture = marqueeRef.current;
      if (marqueeGesture?.pointerId === owner.id) {
        const next = normalizeRect(marqueeGesture.start.x, marqueeGesture.start.y, point.x, point.y);
        setMarquee(next);
        const selected = new Set(marqueeGesture.baseline);
        elementsInsideSelection(objectStateRef.current.elements, next).forEach((id) => selected.add(id));
        setSelectedIds([...selected]);
        return;
      }
      const eraseGesture = eraserRef.current;
      if (eraseGesture?.pointerId === owner.id) {
        const hit = [...eraseGesture.baseline].reverse().find((element) =>
          !eraseGesture.deleted.has(element.id) && sceneElementContains(element, point));
        if (hit) {
          expandGroupSelection(eraseGesture.baseline, new Set([hit.id]))
            .forEach((id) => eraseGesture.deleted.add(id));
          setSceneElements(deleteSceneSelection(eraseGesture.baseline, eraseGesture.deleted));
          setSelectedIds([]);
        }
        return;
      }
      const gesture = annotationGestureRef.current;
      if (!shouldHandlePointer(gesture, owner.id) || phase !== "editing") return;
      const canvas = shotRef.current;
      if (!canvas) {
        annotationGestureRef.current = null;
        setError("截图画布在绘制过程中不可用，请重新截图");
        return;
      }
      const scale = canvas.width / Math.max(1, selection?.width || canvas.width);
      appendGesturePoint(gesture, point);
      if (!gesture.changed) return;
      if (gesture.tool === "arrow" || gesture.tool === "line") {
        setBindingTargetId(bindingAtPoint(objectStateRef.current.elements, point, gesture.id)?.elementId ?? null);
      }

      queueAnnotationPreview(scale);
    },
    [phase, queueAnnotationPreview, selection, setSceneElements, setSelectedIds],
  );

  const finishNativeCanvasInput = useCallback(
    (owner: NativeInputOwner) => {
      if (marqueeRef.current?.pointerId === owner.id) {
        marqueeRef.current = null;
        setMarquee(null);
        return;
      }
      if (eraserRef.current?.pointerId === owner.id) {
        const changed = eraserRef.current.deleted.size > 0;
        eraserRef.current = null;
        commitObjectMutation(changed);
        return;
      }
      const gesture = annotationGestureRef.current;
      if (!shouldHandlePointer(gesture, owner.id)) return;
      flushAnnotationPreview();
      cancelAnnotationPreview();
      if ((gesture.tool === "line" || gesture.tool === "arrow")
        && (!gesture.changed || (gesture.multiClick && !gesture.completeOnFinish))) {
        gesture.multiClick = true;
        gesture.changed = gesture.points.length > 1;
        linearCreationRef.current = gesture;
        annotationGestureRef.current = null;
        const canvas = shotRef.current;
        const scale = canvas ? canvas.width / Math.max(1, selection?.width ?? canvas.width) : 1;
        setRasterPreview(annotationFromGesture(gesture, scale));
        return;
      }
      annotationGestureRef.current = null;
      linearCreationRef.current = null;
      const canvas = shotRef.current;
      const scale = canvas ? canvas.width / Math.max(1, selection?.width ?? canvas.width) : 1;
      const preview = annotationFromGesture(gesture, scale);
      setRasterPreview(null);
      setBindingTargetId(null);
      // A drag too short to produce a shape leaves the canvas untouched.
      if (resolveAnnotationGesture(gesture, false).commit && isPaintableAnnotation(preview)) {
        const committed = (preview.kind === "arrow" || preview.kind === "line") && !gesture.disableBinding
          ? {
              ...preview,
              startBinding: bindingAtPoint(objectStateRef.current.elements, preview.points[0], preview.id),
              endBinding: bindingAtPoint(
                objectStateRef.current.elements,
                preview.points[preview.points.length - 1],
                preview.id,
              ),
            }
          : preview;
        pushCurrentObjects();
        setRasterAnnotations([...gesture.baseline, committed]);
        setSelectedIds([committed.id], committed.id);
        if (committed.kind === "arrow" && committed.style.arrowStyle === "label") {
          setArrowLabelDraft("");
          setArrowLabelEditor({ id: committed.id, original: "", isNew: true });
        }
        if (!continuousDraw && committed.style.arrowStyle !== "label") setTool("select");
      }
    },
    [cancelAnnotationPreview, commitObjectMutation, continuousDraw, flushAnnotationPreview, pushCurrentObjects, selection?.width, setSelectedIds, setTool],
  );

  const cancelNativeCanvasInput = useCallback(
    (owner: NativeInputOwner) => {
      if (marqueeRef.current?.pointerId === owner.id) {
        marqueeRef.current = null;
        setMarquee(null);
        return;
      }
      if (eraserRef.current?.pointerId === owner.id) {
        setSceneElements(eraserRef.current.baseline);
        eraserRef.current = null;
        cancelObjectMutation();
        return;
      }
      const gesture = annotationGestureRef.current;
      if (!shouldHandlePointer(gesture, owner.id)) return;
      cancelAnnotationPreview();
      resolveAnnotationGesture(gesture, true);
      setRasterPreview(null);
      setBindingTargetId(null);
      annotationGestureRef.current = null;
    },
    [cancelAnnotationPreview, cancelObjectMutation, setSceneElements],
  );

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
    if (phase !== "editing" || editorStatus !== "failed") return;
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
        const samples = event.getCoalescedEvents?.() ?? [event];
        samples.forEach((sample) =>
          handlers()?.move({ source: "pointer", id: event.pointerId }, sample),
        );
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
  }, [editorStatus, phase]);

  const shotViewportHeight = displayHeight;
  const editorCrop: ExcalidrawCrop | null = selection && fullImageRef.current
    ? selectionToImageCrop(selection, fullImageRef.current)
    : null;

  const selectedStyleTool = tool === "select" ? editorSelection.tool : tool;
  const optionsTool = isExcalidrawStyleTool(selectedStyleTool) ? selectedStyleTool : null;
  const secondarySize = optionsTool && secondaryToolbarSize.width > 0
    ? secondaryToolbarSize
    : undefined;
  const toolbarLayout =
    selection && phase === "editing" && primaryToolbarSize.width > 0
      ? calculateToolbarLayout(selection, viewportSize, primaryToolbarSize, secondarySize)
      : undefined;
  const toolbarMeasured = Boolean(
    toolbarLayout && (!optionsTool || (secondarySize && toolbarLayout.secondary)),
  );

  // Tools usable as soon as crop is on canvas — only lock while an action is running
  const toolsLocked = busy || !shotReady || editorStatus !== "ready";
  const actionsLocked = busy || !shotReady || editorStatus === "loading";
  const toolSettings: ToolSettings = {
    mixedProperties: editorSelection.mixedProperties ?? [],
    strokeColor,
    outline: activeOutline,
    strokeWidth,
    shapeKind,
    lineStyle: selectedRasterForTool
      ? normalizeLineStyle(selectedRasterForTool.style.lineStyle)
      : lineStyle,
    fillStyle,
    fillColor,
    roughness,
    roundness,
    opacity,
    arrowStyle,
    startArrowhead,
    endArrowhead,
    penWidth,
    penPressure,
    highlightWidth,
    highlightOpacity,
    mosaicBlock,
    pickerFormat,
    textStyle,
    numberStyle,
  };
  const displayedToolSettings: ToolSettings = editorSelection.count > 0
    ? {
        ...toolSettings,
        ...(editorSelection.strokeColor === undefined ? {} : { strokeColor: editorSelection.strokeColor }),
        ...(editorSelection.strokeWidth === undefined ? {} : { strokeWidth: editorSelection.strokeWidth }),
        ...(editorSelection.tool === "pen" && editorSelection.strokeWidth !== undefined
          ? { penWidth: editorSelection.strokeWidth }
          : {}),
        ...(editorSelection.lineStyle === undefined ? {} : { lineStyle: editorSelection.lineStyle }),
        ...(editorSelection.fillColor === undefined ? {} : { fillColor: editorSelection.fillColor }),
        ...(editorSelection.fillStyle === undefined ? {} : { fillStyle: editorSelection.fillStyle }),
        ...(editorSelection.roughness === undefined ? {} : { roughness: editorSelection.roughness }),
        ...(editorSelection.roundness === undefined ? {} : { roundness: editorSelection.roundness }),
        ...(editorSelection.opacity === undefined ? {} : { opacity: editorSelection.opacity }),
        mixedProperties: editorSelection.mixedProperties ?? [],
        ...(editorSelection.arrowStyle === undefined ? {} : { arrowStyle: editorSelection.arrowStyle }),
        ...(editorSelection.startArrowhead === undefined
          ? {}
          : { startArrowhead: editorSelection.startArrowhead }),
        ...(editorSelection.endArrowhead === undefined ? {} : { endArrowhead: editorSelection.endArrowhead }),
        ...(editorSelection.textStyle === undefined ? {} : { textStyle: editorSelection.textStyle }),
      }
    : toolSettings;
  const updateToolSettings = (
    initialChanges: Partial<ToolSettings>,
    styleTool: AnnotTool = tool,
    persist = true,
  ): void => {
    const selectedText = objectStateRef.current.textObjects.find(
      (item) => item.id === selectedTextId,
    );
    const selectedNumber = objectStateRef.current.numberObjects.find(
      (item) => item.id === selectedNumberId,
    );
    const selectedRaster = objectStateRef.current.rasterAnnotations.find(
      (item) => item.id === selectedRasterId,
    );
    let changes = initialChanges;
    if (initialChanges.outline && (selectedText || tool === "text")) {
      changes = {
        ...changes,
        textStyle: {
          ...textStyle,
          strokeColor: initialChanges.outline.color,
          strokeWidth: initialChanges.outline.enabled ? initialChanges.outline.width : 0,
        },
      };
    }
    if (initialChanges.outline && (selectedNumber || tool === "number")) {
      changes = {
        ...changes,
        numberStyle: {
          ...numberStyle,
          outline: { ...initialChanges.outline },
        },
      };
    }
    const canvas = shotRef.current;
    const annotationScale = canvas
      ? canvas.width / Math.max(1, selection?.width ?? canvas.width)
      : 1;
    const rasterStylePatch: Partial<RasterAnnotation["style"]> = {};
    if (changes.strokeColor !== undefined) rasterStylePatch.color = changes.strokeColor;
    if (changes.outline !== undefined && selectedRaster?.kind !== "mosaic") {
      rasterStylePatch.outline = {
        ...changes.outline,
        width: changes.outline.width * annotationScale,
      };
    }
    if (
      changes.lineStyle !== undefined &&
      selectedRaster &&
      selectedRaster.kind !== "mosaic"
    )
      rasterStylePatch.lineStyle = changes.lineStyle;
    if (changes.arrowStyle !== undefined && selectedRaster?.kind === "arrow")
      rasterStylePatch.arrowStyle = changes.arrowStyle;
    if (changes.fillStyle !== undefined && selectedRaster && isFrameAnnotationKind(selectedRaster.kind))
      rasterStylePatch.fillStyle = changes.fillStyle;
    if (changes.fillColor !== undefined && selectedRaster && isFrameAnnotationKind(selectedRaster.kind))
      rasterStylePatch.backgroundColor = changes.fillColor;
    if (changes.roughness !== undefined && selectedRaster && selectedRaster.kind !== "mosaic")
      rasterStylePatch.roughness = changes.roughness;
    if (changes.startArrowhead !== undefined && selectedRaster?.kind === "arrow")
      rasterStylePatch.startArrowhead = changes.startArrowhead;
    if (changes.endArrowhead !== undefined && selectedRaster?.kind === "arrow")
      rasterStylePatch.endArrowhead = changes.endArrowhead;
    if (
      changes.strokeWidth !== undefined &&
      selectedRaster &&
      selectedRaster.kind !== "pen" &&
      selectedRaster.kind !== "highlight"
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
    if (
      changes.textStyle !== undefined &&
      selectedRaster?.kind === "arrow" &&
      selectedRaster.style.arrowStyle === "label"
    ) {
      rasterStylePatch.arrowLabelStyle = {
        ...changes.textStyle,
        fontSize: changes.textStyle.fontSize * annotationScale,
        strokeWidth: changes.textStyle.strokeWidth * annotationScale,
      };
    }
    const changesFrameKind = Boolean(
      selectedRaster &&
      isFrameAnnotationKind(selectedRaster.kind) &&
      changes.shapeKind !== undefined &&
      selectedRaster.kind !== changes.shapeKind,
    );
    const changesRaster = Boolean(
      selectedRaster &&
      ((Object.keys(rasterStylePatch) as Array<keyof RasterAnnotation["style"]>).some(
        (key) => rasterStylePatch[key] !== selectedRaster.style[key],
      ) ||
        changesFrameKind),
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
    if (selectedIds.length > 1) {
      const selectedSet = new Set(selectedIds);
      setSceneElements((previous) => previous.map((element) => {
        if (!selectedSet.has(element.id)) return element;
        if (element.type === "raster" && selectedRaster) {
          const compatible = element.value.kind === selectedRaster.kind
            || (isFrameAnnotationKind(element.value.kind) && isFrameAnnotationKind(selectedRaster.kind));
          if (!compatible) return element;
          const value = changes.shapeKind !== undefined && isFrameAnnotationKind(element.value.kind)
            ? convertFrameAnnotation(element.value, changes.shapeKind)
            : element.value;
          return sceneElement({
            ...value,
            style: { ...value.style, ...rasterStylePatch },
            version: (value.version ?? 0) + 1,
          });
        }
        if (element.type === "text" && changes.textStyle) {
          return sceneElement({ ...element.value, ...changes.textStyle, version: (element.value.version ?? 0) + 1 });
        }
        if (element.type === "number" && changes.numberStyle) {
          return sceneElement({ ...element.value, style: { ...changes.numberStyle }, version: (element.value.version ?? 0) + 1 });
        }
        return element;
      }));
    }
    const styleSource = selectedRaster?.kind ??
      (selectedText ? "text" : selectedNumber ? "number" : styleTool);
    const visualTool = visualToolFor(styleSource);
    const usesSharedColor = isFrameAnnotationKind(styleSource) ||
      styleSource === "line" || styleSource === "arrow" || styleSource === "pen" ||
      styleSource === "text";
    if (changes.strokeColor !== undefined) {
      if (usesSharedColor) {
        updateSharedColor(changes.strokeColor);
        setTextStyle((current) => ({ ...current, color: changes.strokeColor! }));
      } else if (visualTool) {
        updateVisual(visualTool, { color: changes.strokeColor });
      }
    }
    if (changes.outline !== undefined) setOutlineStyle(changes.outline);
    if (changes.lineStyle !== undefined && visualTool)
      updateVisual(visualTool, { lineStyle: changes.lineStyle });
    if (changes.strokeWidth !== undefined) setStrokeWidth(changes.strokeWidth);
    if (changes.shapeKind !== undefined) {
      setShapeKind(changes.shapeKind);
      if (isFrameAnnotationKind(styleTool)) setTool(changes.shapeKind);
    }
    if (changes.arrowStyle !== undefined) setArrowStyle(changes.arrowStyle);
    if (changes.fillStyle !== undefined) setFillStyle(changes.fillStyle);
    if (changes.fillColor !== undefined) setFillColor(changes.fillColor);
    if (changes.roughness !== undefined) setRoughness(changes.roughness);
    if (changes.roundness !== undefined) setRoundness(changes.roundness);
    if (changes.opacity !== undefined) {
      setOpacity(changes.opacity);
      setTextStyle((current) => ({ ...current, opacity: changes.opacity! }));
    }
    if (changes.startArrowhead !== undefined) setStartArrowhead(changes.startArrowhead);
    if (changes.endArrowhead !== undefined) setEndArrowhead(changes.endArrowhead);
    if (changes.penWidth !== undefined) setPenWidth(changes.penWidth);
    if (changes.penPressure !== undefined) setPenPressure(changes.penPressure);
    if (changes.highlightWidth !== undefined) setHighlightWidth(changes.highlightWidth);
    if (changes.highlightOpacity !== undefined) setHighlightOpacity(changes.highlightOpacity);
    if (changes.mosaicBlock !== undefined) setMosaicBlock(changes.mosaicBlock);
    if (selectedRaster && changesRaster) {
      objectStyleChangedRef.current = true;
      setRasterAnnotations((previous) =>
        previous.map((item) =>
          item.id === selectedRaster.id
            ? {
                ...(changesFrameKind ? convertFrameAnnotation(item, changes.shapeKind!) : item),
                style: { ...item.style, ...rasterStylePatch },
              }
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
                        Math.max(12, (changes.numberStyle!.size * scale) / 2) +
                          (changes.numberStyle!.outline.enabled
                            ? changes.numberStyle!.outline.width * scale
                            : 0),
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
      lastTextFontSize.current = nearestTextSize(changes.textStyle.fontSize);
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
    if (persist && changes.pickerFormat !== undefined) {
      void updateScreenshotConfig(
        { color_copy_format: changes.pickerFormat },
        "取色复制格式保存失败",
      );
    }
    const styleKey = isFrameAnnotationKind(styleSource) ? "shape"
      : styleSource === "line" || styleSource === "arrow" || styleSource === "pen" || styleSource === "highlight" || styleSource === "text" || styleSource === "number" || styleSource === "mosaic"
        ? styleSource : null;
    if (persist && styleKey) {
      const current = annotationStyles[styleKey];
      const next = {
        ...annotationStyles,
        [styleKey]: {
          ...current,
          ...(changes.strokeColor !== undefined ? { stroke_color: changes.strokeColor } : {}),
          ...(changes.strokeWidth !== undefined ? { stroke_width: changes.strokeWidth } : {}),
          ...(changes.penWidth !== undefined ? { stroke_width: changes.penWidth } : {}),
          ...(changes.penPressure !== undefined ? { pressure: changes.penPressure } : {}),
          ...(changes.highlightWidth !== undefined ? { stroke_width: changes.highlightWidth } : {}),
          ...(changes.lineStyle !== undefined ? { stroke_style: changes.lineStyle } : {}),
          ...(changes.fillStyle !== undefined ? { fill_style: changes.fillStyle } : {}),
          ...(changes.fillColor !== undefined ? { background_color: changes.fillColor } : {}),
          ...(changes.roughness !== undefined ? { roughness: changes.roughness } : {}),
          ...(changes.opacity !== undefined ? { opacity: changes.opacity / 100 } : {}),
          ...(changes.arrowStyle !== undefined ? { arrow_type: normalizeArrowStyle(changes.arrowStyle) } : {}),
          ...(changes.startArrowhead !== undefined ? { start_arrowhead: changes.startArrowhead } : {}),
          ...(changes.endArrowhead !== undefined ? { end_arrowhead: changes.endArrowhead } : {}),
          ...(changes.highlightOpacity !== undefined ? { opacity: changes.highlightOpacity } : {}),
          ...(changes.mosaicBlock !== undefined ? { block_size: changes.mosaicBlock } : {}),
          ...(changes.textStyle !== undefined ? { stroke_color: changes.textStyle.color, font_size: changes.textStyle.fontSize } : {}),
          ...(changes.numberStyle !== undefined ? { stroke_color: changes.numberStyle.textColor, background_color: changes.numberStyle.backgroundColor, marker_size: changes.numberStyle.size } : {}),
          ...(changes.outline !== undefined ? {
            outline_enabled: changes.outline.enabled,
            outline_color: changes.outline.color,
            outline_width: changes.outline.width,
          } : {}),
        },
      };
      if (changes.strokeColor !== undefined && usesSharedColor) {
        (["shape", "line", "arrow", "pen", "text"] as const).forEach((key) => {
          next[key] = { ...next[key], stroke_color: changes.strokeColor! };
        });
      }
      void updateAnnotationStyles(next, "标注样式保存失败；本次截图仍保留当前样式");
    }
  };

  return (
    <div className="screenshot-overlay">
      <canvas
        ref={bgRef}
        className="screenshot-canvas"
        style={{ pointerEvents: phase === "selecting" ? "auto" : "none" }}
        onPointerDown={onBgPointerDown}
        onPointerMove={onBgPointerMove}
        onPointerUp={onBgPointerUp}
        onPointerCancel={onBgPointerCancel}
        onPointerLeave={() => {
          if (!draggingRef.current) setHoveredWindow(null);
        }}
      />

      {phase === "editing" && selection && (
        <div
          ref={shotViewportRef}
          className="shot-viewport shot-viewport--excalidraw"
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
          <Suspense fallback={<div className="excalidraw-editor-loading">标注工具加载中…</div>}>
            {shotReady && shotBaseRef.current ? (
              <ExcalidrawScreenshotEditor
                ref={excalidrawEditorRef}
                baseCanvas={shotBaseRef.current}
                captureKey={`capture-${captureGenerationRef.current}`}
                crop={editorCrop}
                strokeColor={strokeColor}
                strokeWidth={tool === "pen" || (tool === "select" && editorSelection.tool === "pen")
                  ? penWidth
                  : strokeWidth}
                fillColor={fillColor}
                fillStyle={fillStyle}
                lineStyle={lineStyle}
                roughness={roughness}
                roundness={roundness}
                opacity={opacity}
                arrowStyle={arrowStyle}
                startArrowhead={startArrowhead}
                endArrowhead={endArrowhead}
                textStyle={textStyle}
                onReady={handleEditorReady}
                onError={handleEditorError}
                onSelectionChange={handleEditorSelectionChange}
                onToolChange={setTool}
              />
            ) : (
              <div className="excalidraw-editor-loading">正在准备截图底图…</div>
            )}
          </Suspense>
          {marquee && shotRef.current && (
            <div
              className="scene-marquee"
              style={{
                left: marquee.x / (shotRef.current.width / Math.max(1, selection.width)),
                top: marquee.y / (shotRef.current.height / Math.max(1, displayHeight)),
                width: marquee.width / (shotRef.current.width / Math.max(1, selection.width)),
                height: marquee.height / (shotRef.current.height / Math.max(1, displayHeight)),
              }}
            />
          )}
          {snapGuides.map((guide, index) => {
            const canvas = shotRef.current;
            if (!canvas) return null;
            const scaleX = canvas.width / Math.max(1, selection.width);
            const scaleY = canvas.height / Math.max(1, displayHeight);
            return (
              <span
                key={`${guide.axis}-${guide.value}-${index}`}
                className={`scene-snap-guide scene-snap-guide--${guide.axis}`}
                style={guide.axis === "x"
                  ? { left: guide.value / scaleX }
                  : { top: guide.value / scaleY }}
              />
            );
          })}
          {rasterAnnotations.map((annotation) => {
            const canvas = shotRef.current;
            const scaleX = canvas ? canvas.width / Math.max(1, selection.width) : 1;
            const scaleY = canvas ? canvas.height / Math.max(1, displayHeight) : scaleX;
            const bounds = annotationBounds(annotation);
            const interactive =
              tool === "select" || tool === "eraser" || tool === annotation.kind ||
              (isFrameAnnotationKind(tool) && isFrameAnnotationKind(annotation.kind));
            const selected = interactive && selectedIds.includes(annotation.id);
            return (
              <div
                key={annotation.id}
                className={`raster-object${interactive ? " is-interactive" : ""}${selected ? " is-selected" : ""}${bindingTargetId === annotation.id ? " is-binding-target" : ""}`}
                style={{
                  left: bounds.x / scaleX,
                  top: bounds.y / scaleY,
                  width: bounds.width / scaleX,
                  height: bounds.height / scaleY,
                  pointerEvents: interactive ? "auto" : "none",
                  zIndex: 4 + sceneElements.findIndex((element) => element.id === annotation.id),
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (tool === "eraser") {
                    pushCurrentObjects();
                    const ids = expandGroupSelection(sceneElements, new Set([annotation.id]));
                    setSceneElements((previous) => deleteSceneSelection(previous, ids));
                    setSelectedIds([]);
                    return;
                  }
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const annotationGroup = annotation.groupId ?? null;
                  const ids = annotationGroup && activeGroupId === annotationGroup
                    ? new Set([annotation.id])
                    : expandGroupSelection(sceneElements, new Set([annotation.id]));
                  const dragIds = tool === "select" && selectedIds.includes(annotation.id)
                    ? new Set(selectedIds) : ids;
                  if (tool === "select" && event.shiftKey) {
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      const removing = [...ids].every((id) => next.has(id));
                      ids.forEach((id) => removing ? next.delete(id) : next.add(id));
                      return [...next];
                    }, annotation.id);
                  } else setSelectedIds([...dragIds], annotation.id);
                  const visualTool = visualToolFor(annotation.kind);
                  if (visualTool) {
                    updateVisual(visualTool, {
                      lineStyle: normalizeLineStyle(
                        annotation.style.lineStyle,
                        annotation.style.shapeEffect,
                        annotation.style.arrowBrushId ?? annotation.style.arrowEffect,
                      ),
                    });
                  }
                  // Frame width is independent from pen and highlighter sizes.
                  if (isFrameAnnotationKind(annotation.kind))
                    setStrokeWidth(Math.max(1, Math.round(annotation.style.strokeWidth / scaleX)));
                  if (isFrameAnnotationKind(annotation.kind) && tool !== "select") {
                    setShapeKind(annotation.kind);
                    setTool(annotation.kind);
                  }
                  if (annotation.kind === "arrow") {
                    setArrowStyle(annotation.style.arrowStyle);
                    setStartArrowhead(annotation.style.startArrowhead ?? "none");
                    setEndArrowhead(annotation.style.endArrowhead ?? "arrow");
                  }
                  if (annotation.kind === "arrow" || annotation.kind === "line")
                    setStrokeWidth(Math.max(1, Math.round(annotation.style.strokeWidth / scaleX)));
                  setFillStyle(annotation.style.fillStyle ?? "none");
                  setFillColor(annotation.style.backgroundColor ?? "#ffc9c9");
                  setRoughness(annotation.style.roughness ?? 1);
                  if (annotation.style.arrowLabelStyle) {
                    setTextStyle({
                      ...annotation.style.arrowLabelStyle,
                      fontSize: annotation.style.arrowLabelStyle.fontSize / scaleX,
                      strokeWidth: annotation.style.arrowLabelStyle.strokeWidth / scaleX,
                    });
                  }
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
                  if (tool === "select") {
                    const groupBounds = getSceneSelectionBounds(sceneElements, dragIds);
                    if (groupBounds && !event.shiftKey) {
                      sceneTransformRef.current = {
                        pointerId: event.pointerId,
                        mode: "move",
                        startX: event.clientX,
                        startY: event.clientY,
                        baseline: cloneSceneElements(sceneElements),
                        selectedIds: dragIds,
                        bounds: groupBounds,
                        changed: false,
                      };
                      beginObjectMutation();
                    }
                    return;
                  }
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
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (annotation.groupId && activeGroupId !== annotation.groupId) {
                    setActiveGroupId(annotation.groupId);
                    setSelectedIds([annotation.id], annotation.id);
                    return;
                  }
                  if ((annotation.kind === "line" || annotation.kind === "arrow") && annotation.style.arrowStyle !== "label") {
                    cancelObjectMutation();
                    setSelectedIds([annotation.id], annotation.id);
                    setLinearEditId(annotation.id);
                    return;
                  }
                  if (isFrameAnnotationKind(annotation.kind)) {
                    const contained = textObjects.find((item) => item.containerId === annotation.id);
                    if (contained) {
                      openTextObjectEditor(contained);
                      return;
                    }
                    const centerX = bounds.x + bounds.width / 2;
                    const centerY = bounds.y + bounds.height / 2;
                    setTextEditor({
                      containerId: annotation.id,
                      canvasX: Math.max(0, centerX - 100 * scaleX),
                      canvasY: Math.max(0, centerY - 28 * scaleY),
                      left: selection.x + centerX / scaleX - 100,
                      top: selection.y + centerY / scaleY - 28,
                      scale: scaleX,
                      transformScale: 1,
                      width: 200 * scaleX,
                      height: 56 * scaleY,
                      ...textStyle,
                    });
                    setTextDraft("");
                    return;
                  }
                  if (annotation.kind !== "arrow" || annotation.style.arrowStyle !== "label") return;
                  cancelObjectMutation();
                  setArrowLabelDraft(annotation.style.arrowLabel ?? "");
                  setArrowLabelEditor({
                    id: annotation.id,
                    original: annotation.style.arrowLabel ?? "",
                    isNew: false,
                  });
                }}
              >
                {selected && tool !== "select" &&
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
          {linearEditId && (() => {
            const annotation = rasterAnnotations.find((item) => item.id === linearEditId);
            const canvas = shotRef.current;
            if (!annotation || !canvas) return null;
            const scaleX = canvas.width / Math.max(1, selection.width);
            const scaleY = canvas.height / Math.max(1, displayHeight);
            return annotation.points.map((point, index) => (
              <span
                key={`${annotation.id}-node-${index}`}
                className="linear-node"
                style={{ left: point.x / scaleX, top: point.y / scaleY }}
                title="拖动节点；Ctrl 拖动端点临时禁用绑定"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  linearNodeRef.current = {
                    pointerId: event.pointerId,
                    id: annotation.id,
                    index,
                    origin: cloneRasterAnnotations([annotation])[0],
                    changed: false,
                  };
                  beginObjectMutation();
                }}
              />
            ));
          })()}
          {linearEditId && (() => {
            const annotation = rasterAnnotations.find((item) => item.id === linearEditId);
            const canvas = shotRef.current;
            if (!annotation || !canvas) return null;
            const scaleX = canvas.width / Math.max(1, selection.width);
            const scaleY = canvas.height / Math.max(1, displayHeight);
            return annotation.points.map((point, index) => (
              <span
                key={`${annotation.id}-node-${index}`}
                className="linear-node-handle"
                style={{ left: point.x / scaleX, top: point.y / scaleY }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  linearNodeRef.current = {
                    pointerId: event.pointerId,
                    id: annotation.id,
                    index,
                    origin: cloneRasterAnnotations([annotation])[0],
                    changed: false,
                  };
                  beginObjectMutation();
                }}
              />
            ));
          })()}
          {arrowLabelEditor &&
            (() => {
              const annotation = rasterAnnotations.find((item) => item.id === arrowLabelEditor.id);
              const canvas = shotRef.current;
              if (!annotation || !canvas) return null;
              const first = annotation.points[0];
              const last = annotation.points[annotation.points.length - 1] ?? first;
              const scaleX = canvas.width / Math.max(1, selection.width);
              const scaleY = canvas.height / Math.max(1, displayHeight);
              const labelStyle = annotation.style.arrowLabelStyle ?? DEFAULT_TEXT_STYLE;
              return (
                <input
                  autoFocus
                  className="inline-arrow-label-editor"
                  value={arrowLabelDraft}
                  placeholder="输入箭头文字"
                  style={{
                    left: (first.x + last.x) / 2 / scaleX,
                    top: (first.y + last.y) / 2 / scaleY,
                    color: labelStyle.color,
                    fontFamily: fontFamily(labelStyle.font),
                    fontSize: labelStyle.fontSize / scaleX,
                    fontWeight: labelStyle.bold ? 700 : 400,
                  }}
                  onChange={(event) => setArrowLabelDraft(event.target.value)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onBlur={commitArrowLabel}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitArrowLabel();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      cancelArrowLabel();
                    }
                  }}
                />
              );
            })()}
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
                className={`text-object${textObjectsInteractive ? " is-interactive" : ""}${selectedIds.includes(obj.id) && textObjectsInteractive ? " is-selected" : ""}${bindingTargetId === obj.id ? " is-binding-target" : ""}`}
                style={{
                  left: obj.canvasX / scaleX,
                  top: obj.canvasY / scaleY,
                  width: (obj.width * obj.transformScale) / scaleX,
                  minHeight: (obj.height * obj.transformScale) / scaleY,
                  color: "transparent",
                  fontSize: obj.fontSize * obj.transformScale,
                  fontFamily: fontFamily(obj.font),
                  fontWeight: obj.bold ? 700 : 400,
                  WebkitTextStroke: undefined,
                  lineHeight: 1.25,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                  pointerEvents: textObjectsInteractive ? "auto" : "none",
                  padding: `${4 * obj.transformScale}px`,
                  transform: `rotate(${obj.angle ?? 0}rad)`,
                  transformOrigin: "center",
                  zIndex: 4 + sceneElements.findIndex((element) => element.id === obj.id),
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const ids = obj.groupId && activeGroupId === obj.groupId
                    ? new Set([obj.id])
                    : expandGroupSelection(sceneElements, new Set([obj.id]));
                  const dragIds = tool === "select" && selectedIds.includes(obj.id)
                    ? new Set(selectedIds) : ids;
                  if (tool === "select" && event.shiftKey) {
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      const removing = [...ids].every((id) => next.has(id));
                      ids.forEach((id) => removing ? next.delete(id) : next.add(id));
                      return [...next];
                    }, obj.id);
                  } else setSelectedIds([...dragIds], obj.id);
                  if (tool !== "select") setTool("text");
                  setTextStyle({
                    fontSize: nearestTextSize(obj.fontSize * obj.transformScale),
                    color: obj.color,
                    font: obj.font,
                    textAlign: obj.textAlign,
                    opacity: obj.opacity,
                    bold: obj.bold,
                    strokeColor: obj.strokeColor,
                    strokeWidth: obj.strokeWidth,
                  });
                  if (tool === "select") {
                    const groupBounds = getSceneSelectionBounds(sceneElements, dragIds);
                    if (groupBounds && !event.shiftKey) {
                      sceneTransformRef.current = {
                        pointerId: event.pointerId, mode: "move",
                        startX: event.clientX, startY: event.clientY,
                        baseline: cloneSceneElements(sceneElements), selectedIds: dragIds,
                        bounds: groupBounds, changed: false,
                      };
                      beginObjectMutation();
                    }
                    return;
                  }
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
                  if (obj.groupId && activeGroupId !== obj.groupId) {
                    setActiveGroupId(obj.groupId);
                    setSelectedIds([obj.id], obj.id);
                    return;
                  }
                  openTextObjectEditor(obj);
                }}
              >
                {obj.text}
                {selectedTextId === obj.id && tool !== "select" &&
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
            const selected = selectedIds.includes(item.id) && isNumberObjectInteractive(tool);
            const outlineShadow = "";
            const numberShadow = [
              outlineShadow,
              ...(selected
                ? ["0 0 0 3px rgba(255, 255, 255, 0.9)", "0 0 0 7px rgba(99, 102, 241, 0.28)"]
                : []),
            ]
              .filter(Boolean)
              .join(", ");
            return (
              <div
                key={item.id}
                className={`number-object${isNumberObjectInteractive(tool) ? " is-interactive" : ""}${selected ? " is-selected" : ""}${bindingTargetId === item.id ? " is-binding-target" : ""}`}
                style={{
                  left: item.canvasX / scaleX,
                  top: item.canvasY / scaleY,
                  width: item.style.size,
                  height: item.style.size,
                  backgroundColor: "transparent",
                  color: "transparent",
                  fontSize: Math.round(item.style.size * 0.56),
                  boxShadow: numberShadow || undefined,
                  transform: `translate(-50%, -50%) rotate(${item.angle ?? 0}rad)`,
                  zIndex: 4 + sceneElements.findIndex((element) => element.id === item.id),
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  const ids = item.groupId && activeGroupId === item.groupId
                    ? new Set([item.id])
                    : expandGroupSelection(sceneElements, new Set([item.id]));
                  const dragIds = tool === "select" && selectedIds.includes(item.id)
                    ? new Set(selectedIds) : ids;
                  if (tool === "select" && event.shiftKey) {
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      const removing = [...ids].every((id) => next.has(id));
                      ids.forEach((id) => removing ? next.delete(id) : next.add(id));
                      return [...next];
                    }, item.id);
                  } else setSelectedIds([...dragIds], item.id);
                  setNumberStyle({ ...item.style });
                  if (tool === "select") {
                    const groupBounds = getSceneSelectionBounds(sceneElements, dragIds);
                    if (groupBounds && !event.shiftKey) {
                      sceneTransformRef.current = {
                        pointerId: event.pointerId, mode: "move",
                        startX: event.clientX, startY: event.clientY,
                        baseline: cloneSceneElements(sceneElements), selectedIds: dragIds,
                        bounds: groupBounds, changed: false,
                      };
                      beginObjectMutation();
                    }
                    return;
                  }
                  numberDragRef.current = {
                    pointerId: event.pointerId,
                    id: item.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    originCanvasX: item.canvasX,
                    originCanvasY: item.canvasY,
                    radius:
                      Math.max(12, (item.style.size * displayScale) / 2) +
                      (item.style.outline.enabled
                        ? item.style.outline.width * displayScale
                        : 0),
                    changed: false,
                  };
                  beginObjectMutation();
                }}
                onDoubleClick={(event) => {
                  if (!item.groupId || activeGroupId === item.groupId) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setActiveGroupId(item.groupId);
                  setSelectedIds([item.id], item.id);
                }}
              >
                {item.value}
              </div>
            );
          })}
          {tool === "select" && selectedIds.length > 0 && (() => {
            const canvas = shotRef.current;
            const ids = new Set(selectedIds);
            const bounds = getSceneSelectionBounds(sceneElements, ids);
            if (!canvas || !bounds) return null;
            const scaleX = canvas.width / Math.max(1, selection.width);
            const scaleY = canvas.height / Math.max(1, displayHeight);
            const begin = (event: React.PointerEvent, mode: "move" | "rotate" | ResizeHandle) => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              sceneTransformRef.current = {
                pointerId: event.pointerId,
                mode,
                startX: event.clientX,
                startY: event.clientY,
                baseline: cloneSceneElements(sceneElements),
                selectedIds: ids,
                bounds,
                changed: false,
              };
              beginObjectMutation();
            };
            return (
              <div
                className="scene-selection"
                style={{
                  left: bounds.x / scaleX,
                  top: bounds.y / scaleY,
                  width: Math.max(1, bounds.width / scaleX),
                  height: Math.max(1, bounds.height / scaleY),
                }}
              >
                {RESIZE_HANDLES.map((handle) => (
                  <span
                    key={handle}
                    className={`scene-selection__handle scene-selection__handle--${handle}`}
                    onPointerDown={(event) => begin(event, handle)}
                  />
                ))}
                <span
                  className="scene-selection__rotate"
                  title="旋转（Shift 按 15°）"
                  onPointerDown={(event) => begin(event, "rotate")}
                />
              </div>
            );
          })()}
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
        RESIZE_HANDLES.filter(
          (handle) => !aspectRatio || !["n", "e", "s", "w"].includes(handle),
        ).map((handle) => {
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
        <div className="ocr-result-panel ocr-result-panel--text" onMouseDown={(event) => event.stopPropagation()}>
          <div className="ocr-result-panel__header">
            <strong>{t.ocr.title}</strong>
            {ocrPanel.elapsedMs !== null && (
              <span className="ocr-result-panel__elapsed">{t.ocr.completedIn(ocrPanel.elapsedMs)}</span>
            )}
            <button
              type="button"
              className="ocr-result-panel__close"
              aria-label={t.ocr.close}
              title={t.ocr.close}
              onClick={closeOcr}
            >
              ×
            </button>
          </div>
          <section className="ocr-result-panel__body">
            {ocrPanel.pending ? (
              <p className="ocr-result-panel__state">{t.ocr.recognizing}</p>
            ) : ocrPanel.error ? (
              <div className="ocr-result-panel__state ocr-result-panel__state--error">
                <p>{ocrPanel.error}</p>
                <button type="button" onClick={runOcr}>{t.ocr.retry}</button>
              </div>
            ) : ocrPanel.result?.text.trim() ? (
              <pre className="ocr-result-panel__text" tabIndex={0}>{ocrPanel.result.text}</pre>
            ) : (
              <p className="ocr-result-panel__state">{t.ocr.noTextFound}</p>
            )}
          </section>
          {ocrPanel.result?.text.trim() && !ocrPanel.error ? (
            <div className="ocr-result-panel__footer">
              {ocrCopyState === "failed" && (
                <span className="ocr-result-panel__copy-error">{t.ocr.copyFailed}</span>
              )}
              <button
                type="button"
                className="ocr-result-panel__copy"
                disabled={ocrCopyState === "copied"}
                onClick={() => void copyOcrResult()}
              >
                {ocrCopyState === "copied" ? t.ocr.copied : t.ocr.copy}
              </button>
            </div>
          ) : null}
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
            shapeKind={shapeKind}
            canUndo={editorReady}
            canRedo={editorReady}
            compact={compactToolbar}
            toolsDisabled={toolsLocked}
            actionsDisabled={actionsLocked}
            confirmDisabled={actionsLocked}
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
              if (arrowLabelEditor) commitArrowLabel();
              if (objectMutationRef.current.active) {
                commitObjectMutation(objectStyleChangedRef.current);
                objectStyleChangedRef.current = false;
              }
              closeToolbarPopups();
              setTool(next);
              excalidrawEditorRef.current?.setTool(next);
              if (isFrameAnnotationKind(next)) setShapeKind(next);
              const selectedRaster = objectStateRef.current.rasterAnnotations.find(
                (item) => item.id === selectedRasterId,
              );
              if (
                !selectedRaster ||
                (next !== selectedRaster.kind &&
                  !(isFrameAnnotationKind(next) && isFrameAnnotationKind(selectedRaster.kind)))
              )
                setSelectedRasterId(null);
              if (next !== "text") setSelectedTextId(null);
              if (next !== "picker") setPickerSample(null);
              if (next !== "number") setSelectedNumberId(null);
            }}
            onUndo={() => excalidrawEditorRef.current?.undo()}
            onRedo={() => excalidrawEditorRef.current?.redo()}
            onSave={() => {
              void runCommittedImageAction(window.api.saveImage, "保存截图失败");
            }}
            onPin={() => {
              void runCommittedImageAction(window.api.pinImage, "贴图失败");
            }}
            onOcr={runOcr}
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
          {optionsTool && (
            <ToolOptionsBar
              key={optionsTool}
              ref={secondaryToolbarRef}
              tool={optionsTool}
              settings={displayedToolSettings}
              onChange={(changes) => {
                excalidrawEditorRef.current?.applyStyle(changes, true);
                updateToolSettings(changes, optionsTool);
              }}
              onPreviewChange={(changes) => {
                excalidrawEditorRef.current?.applyStyle(changes, false);
                updateToolSettings(changes, optionsTool, false);
              }}
              onPopupOpenChange={(open) => reportToolbarPopup("secondary", open)}
              palette={palette}
              paletteBusy={paletteBusy}
              onPaletteCopy={(color) => void copyPaletteColor(color)}
              onPaletteFavorite={(color, favorite) => void setPaletteFavorite(color, favorite)}
              selectedTools={editorSelection.tools}
              style={{
                left: toolbarLayout?.secondary?.left ?? 8,
                top: toolbarLayout?.secondary?.top ?? 8,
                visibility: toolbarMeasured ? "visible" : "hidden",
              }}
            />
          )}
        </>
      )}

      {(busy || editorStatus === "loading" && phase === "editing") && (
        <div className="overlay-status">{busy ? t.hints.working : "标注工具加载中…"}</div>
      )}
    </div>
  );
}

export default ScreenshotOverlay;
