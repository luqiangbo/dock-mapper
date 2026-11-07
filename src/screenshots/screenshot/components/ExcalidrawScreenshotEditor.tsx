import {
  Excalidraw,
  CaptureUpdateAction,
  getCommonBounds,
  viewportCoordsToSceneCoords,
  FONT_FAMILY,
  convertToExcalidrawElements,
  newElementWith,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, ExcalidrawProps } from "@excalidraw/excalidraw/types";
import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { AnnotTool } from "./AnnotationToolbar";
import { MosaicDrawingLayer } from "./MosaicDrawingLayer";
import { SpecialToolLayer } from "./SpecialToolLayer";
import {
  applyNumberBadgeStyle,
  isNumberBadgeBody,
  numberStyleForBadge,
  replaceNumberBadges,
} from "./numberBadge";
import { numberGroupsToErase } from "./specialToolState";
import { editorHistory, type EditorHistoryState, EMPTY_EDITOR_HISTORY } from "./editorHistory";
import type { NumberStyle } from "./annotationTypes";
import type { ColorCopyFormat } from "./pickerColor";
import { useScreenshotViewport } from "../hooks/useScreenshotViewport";
import type { MosaicEffect } from "../../../types";
import type {
  Arrowhead,
  ArrowStyle,
  ElementRoundness,
  FillStyle,
  LineStyle,
  Roughness,
  TextStyle,
  ToolSettings,
} from "./annotationTypes";
import {
  captureBackgroundSkeleton,
  excalidrawCurrentItemRoundness,
  excalidrawFillPatch,
  excalidrawRectangleRoundness,
  excalidrawToolType,
  isSameExcalidrawSelection,
  screenshotEditorPresentation,
  resolveScreenshotTool,
  type ExcalidrawSelectionState,
} from "./excalidrawScreenshotAdapter";
import { annotationHitTest } from "./annotationHitTest";
import { captureAnnotationCanvas } from "./captureAnnotationCanvas";
import { SYSTEM_FONTS } from "./systemFonts";

export interface ExcalidrawScreenshotEditorHandle {
  clearSelection: () => void;
  hitTest: (clientX: number, clientY: number) => boolean;
  exportPng: (background?: HTMLCanvasElement) => Promise<Uint8Array>;
  setTool: (tool: AnnotTool) => void;
  applyStyle: (changes: ExcalidrawStyleChanges, commit?: boolean) => void;
  undo: () => void;
  redo: () => void;
  isEditingText: () => boolean;
  getStatus: () => ExcalidrawEditorStatus;
}

export type ExcalidrawEditorStatus = "loading" | "ready" | "failed";

export interface ExcalidrawCrop {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
}

export type ExcalidrawStyleChanges = Partial<
  Pick<
    ToolSettings,
    | "strokeColor"
    | "strokeWidth"
    | "fillColor"
    | "fillStyle"
    | "lineStyle"
    | "roughness"
    | "roundness"
    | "opacity"
    | "arrowStyle"
    | "startArrowhead"
    | "endArrowhead"
    | "penWidth"
    | "textStyle"
    | "numberStyle"
    | "highlightWidth"
    | "highlightOpacity"
  >
>;

export type { ExcalidrawSelectionState } from "./excalidrawScreenshotAdapter";

interface Props {
  /** The already-cropped, physical-pixel screenshot canvas. */
  baseCanvas: HTMLCanvasElement | null;
  displayCanvas: HTMLCanvasElement | null;
  captureKey: string;
  crop: ExcalidrawCrop | null;
  strokeColor: string;
  strokeWidth: number;
  fillColor: string;
  fillStyle: "none" | "solid" | "hachure" | "cross_hatch" | "zigzag";
  lineStyle: "solid" | "dashed" | "dotted";
  roughness: 0 | 1 | 2;
  roundness: ElementRoundness;
  opacity: number;
  arrowStyle: ArrowStyle;
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
  textStyle: TextStyle;
  numberStyle: NumberStyle;
  pickerFormat: ColorCopyFormat;
  pickerKeyboardBlocked?: boolean;
  onCopyColor: (color: string, formatted: string) => Promise<void>;
  onHistoryChange: (state: EditorHistoryState) => void;
  mosaicBlock: number;
  mosaicEffect: MosaicEffect;
  blurRadius: number;
  interactionDisabled: boolean;
  tool: AnnotTool | null;
  onReady?: () => void;
  onError?: (message: string) => void;
  onDrawingError?: (message: string) => void;
  onSelectionChange?: (selection: ExcalidrawSelectionState) => void;
  onToolChange?: (tool: AnnotTool) => void;
}

const EXCALIDRAW_UI_OPTIONS = {
  canvasActions: { loadScene: false, saveToActiveFile: false, export: false },
} as const;

// Excalidraw otherwise paints its default white app state once on first
// mount, before the imperative API can switch the annotation canvas to
// transparent. Supplying this up front removes that first-capture flash/race.
const EXCALIDRAW_INITIAL_DATA = {
  appState: {
    viewBackgroundColor: "transparent",
    currentItemStrokeColor: "#e03131",
    currentItemStrokeWidth: 6,
    currentItemRoughness: 2,
    currentItemBackgroundColor: "transparent",
    currentItemFontSize: 24,
  },
} as const;

const rejectPaste = () => false;

const FONT_KEYS = {
  virgil: FONT_FAMILY.Virgil,
  helvetica: FONT_FAMILY.Helvetica,
  cascadia: FONT_FAMILY.Cascadia,
  excalifont: FONT_FAMILY.Excalifont,
  nunito: FONT_FAMILY.Nunito,
  lilita: FONT_FAMILY["Lilita One"],
  "comic-shanns": FONT_FAMILY["Comic Shanns"],
  "liberation-sans": FONT_FAMILY["Liberation Sans"],
  sans: FONT_FAMILY.Helvetica,
  serif: FONT_FAMILY.Virgil,
  mono: FONT_FAMILY.Cascadia,
} as const;

function fontFamilyValue(font: TextStyle["font"]): number {
  return (
    SYSTEM_FONTS.find((entry) => entry.key === font)?.id ??
    FONT_KEYS[font as keyof typeof FONT_KEYS] ??
    1001
  );
}

function textFontFromValue(value: number): TextStyle["font"] {
  const system = SYSTEM_FONTS.find((entry) => entry.id === value);
  if (system) return system.key;
  const entry = Object.entries(FONT_KEYS).find(
    ([key, family]) => !["sans", "serif", "mono"].includes(key) && family === value,
  );
  return (entry?.[0] as TextStyle["font"] | undefined) ?? "helvetica";
}

function arrowStyleFromElement(element: { elbowed?: boolean; roundness?: unknown }): ArrowStyle {
  if (element.elbowed) return "elbow";
  return element.roundness ? "round" : "sharp";
}

function supportedArrowhead(value: unknown): Arrowhead {
  return value === "arrow" ||
    value === "triangle" ||
    value === "triangle_outline" ||
    value === "circle" ||
    value === "circle_outline" ||
    value === "dot" ||
    value === "diamond" ||
    value === "diamond_outline" ||
    value === "bar" ||
    value === "crowfoot_one" ||
    value === "crowfoot_many" ||
    value === "crowfoot_one_or_many"
    ? value
    : "none";
}

function annotationToolFromElement(
  element: { type: string; customData?: Record<string, unknown> } | undefined,
): AnnotTool | null {
  if (element?.customData?.dockmapperTool === "number") return "number";
  if (element?.customData?.dockmapperTool === "highlight") return "highlight";
  return element?.type === "rectangle"
    ? "rect"
    : element?.type === "ellipse"
      ? "ellipse"
      : element?.type === "diamond"
        ? "diamond"
        : element?.type === "line"
          ? "line"
          : element?.type === "arrow"
            ? "arrow"
            : element?.type === "freedraw"
              ? "pen"
              : element?.type === "text"
                ? "text"
                : null;
}

/**
 * A deliberately small host adapter: Excalidraw owns drawing interaction and
 * history, while DockMapper owns capture lifecycle and image actions.
 */
const ExcalidrawScreenshotEditor = forwardRef<ExcalidrawScreenshotEditorHandle, Props>(
  function ExcalidrawScreenshotEditor(props, ref): React.JSX.Element {
    const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
    const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
    const {
      rootRef,
      alignViewport,
      scheduleAlignment,
      revision: viewportRevision,
    } = useScreenshotViewport(
      api,
      props.baseCanvas,
      props.displayCanvas,
      props.captureKey,
      props.crop?.sourceX ?? 0,
      props.crop?.sourceY ?? 0,
    );
    const baseCanvasRef = useRef(props.baseCanvas);
    const alignViewportRef = useRef(alignViewport);
    baseCanvasRef.current = props.baseCanvas;
    alignViewportRef.current = alignViewport;
    const hasBaseCanvas = Boolean(props.baseCanvas);
    const callbacksRef = useRef({ onReady: props.onReady, onError: props.onError });
    const selectionCallbackRef = useRef(props.onSelectionChange);
    const toolCallbackRef = useRef(props.onToolChange);
    const textStyleRef = useRef(props.textStyle);
    const previousNumberCount = useRef(0);
    const numberStyleRef = useRef(props.numberStyle);
    numberStyleRef.current = props.numberStyle;
    const defaultFillColorRef = useRef(props.fillColor);
    const gestureIdsRef = useRef(new Set<string>());
    const requestedToolRef = useRef(props.tool);
    requestedToolRef.current = props.tool;
    defaultFillColorRef.current = props.fillColor;
    callbacksRef.current = { onReady: props.onReady, onError: props.onError };
    selectionCallbackRef.current = props.onSelectionChange;
    toolCallbackRef.current = props.onToolChange;
    textStyleRef.current = props.textStyle;
    const appStateRef = useRef<Record<string, unknown>>({});
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const [mosaicActive, setMosaicActive] = useState(false);
    const mosaicActiveRef = useRef(false);
    const cropRef = useRef<ExcalidrawCrop | null>(null);
    const captureKeyRef = useRef("");
    const reportedToolRef = useRef<AnnotTool>("select");
    const reportedSelectionRef = useRef<ExcalidrawSelectionState>({
      tool: null,
      tools: [],
      count: 0,
    });

    useEffect(() => {
      if (props.tool !== "mosaic" && mosaicActiveRef.current) {
        mosaicActiveRef.current = false;
        setMosaicActive(false);
      }
    }, [props.tool]);

    const applyDefaultStyle = useCallback(() => {
      const api = apiRef.current;
      if (!api) return;
      const appState = {
        currentItemStrokeColor: props.strokeColor,
        currentItemBackgroundColor: props.fillStyle === "none" ? "transparent" : props.fillColor,
        currentItemFillStyle:
          props.fillStyle === "none"
            ? "solid"
            : props.fillStyle === "cross_hatch"
              ? "cross-hatch"
              : props.fillStyle,
        currentItemStrokeWidth: props.strokeWidth,
        currentItemStrokeStyle: props.lineStyle,
        currentItemRoughness: props.roughness,
        currentItemArrowType:
          props.arrowStyle === "round" || props.arrowStyle === "elbow" ? props.arrowStyle : "sharp",
        currentItemStartArrowhead: props.startArrowhead === "none" ? null : props.startArrowhead,
        currentItemEndArrowhead: props.endArrowhead === "none" ? null : props.endArrowhead,
        currentItemFontSize: props.textStyle.fontSize,
        currentItemFontFamily: fontFamilyValue(props.textStyle.font),
        currentItemTextAlign: props.textStyle.textAlign,
        currentItemOpacity: props.opacity,
        currentItemRoundness: excalidrawCurrentItemRoundness(props.roundness),
      };
      api.updateScene({
        appState: appState as never,
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
      });
    }, [
      props.arrowStyle,
      props.endArrowhead,
      props.fillColor,
      props.fillStyle,
      props.lineStyle,
      props.opacity,
      props.roughness,
      props.roundness,
      props.startArrowhead,
      props.strokeColor,
      props.strokeWidth,
      props.textStyle,
      props.tool,
    ]);

    const applySelectionStyle = useCallback((changes: ExcalidrawStyleChanges, commit = true) => {
      const api = apiRef.current;
      if (!api) return;
      if (changes.numberStyle && baseCanvasRef.current) {
        applyNumberBadgeStyle(api, baseCanvasRef.current, changes.numberStyle, commit);
        return;
      }
      const selectedIds = api.getAppState().selectedElementIds;
      const selectedCount = Object.keys(selectedIds).length;
      if (!selectedCount) return;
      const elements = api.getSceneElements().map((element) => {
        if (!selectedIds[element.id] || element.locked) return element;
        const kind = annotationToolFromElement(element);
        const isFrame = kind === "rect" || kind === "ellipse" || kind === "diamond";
        const isLinear = isFrame || kind === "line" || kind === "arrow";
        const patch = {
          ...(changes.strokeColor === undefined ? {} : { strokeColor: changes.strokeColor }),
          ...(changes.strokeWidth === undefined || kind === "text"
            ? {}
            : { strokeWidth: changes.strokeWidth }),
          ...(changes.penWidth === undefined || kind !== "pen"
            ? {}
            : { strokeWidth: changes.penWidth }),
          ...(changes.highlightWidth === undefined || kind !== "highlight"
            ? {}
            : { strokeWidth: changes.highlightWidth }),
          ...(changes.highlightOpacity === undefined || kind !== "highlight"
            ? {}
            : { opacity: Math.round(changes.highlightOpacity * 100) }),
          ...(changes.numberStyle === undefined || kind !== "number"
            ? {}
            : element.type === "text"
              ? { strokeColor: changes.numberStyle.textColor }
              : { backgroundColor: changes.numberStyle.backgroundColor }),
          ...(isFrame && (changes.fillColor !== undefined || changes.fillStyle !== undefined)
            ? excalidrawFillPatch(changes, element.backgroundColor, defaultFillColorRef.current)
            : {}),
          ...(isLinear && changes.lineStyle !== undefined
            ? { strokeStyle: changes.lineStyle }
            : {}),
          ...(isLinear && changes.roughness !== undefined ? { roughness: changes.roughness } : {}),
          ...(changes.opacity === undefined ? {} : { opacity: changes.opacity }),
          ...(kind === "rect" && changes.roundness !== undefined
            ? { roundness: excalidrawRectangleRoundness(changes.roundness) }
            : {}),
          ...(kind === "arrow" && changes.arrowStyle !== undefined
            ? changes.arrowStyle === "elbow"
              ? { elbowed: true, roundness: null }
              : {
                  elbowed: false,
                  roundness: changes.arrowStyle === "round" ? { type: 2 } : null,
                }
            : {}),
          ...(kind === "arrow" &&
          (changes.startArrowhead !== undefined || changes.endArrowhead !== undefined)
            ? {
                ...(changes.startArrowhead === undefined
                  ? {}
                  : {
                      startArrowhead:
                        changes.startArrowhead === "none" ? null : changes.startArrowhead,
                    }),
                ...(changes.endArrowhead === undefined
                  ? {}
                  : {
                      endArrowhead: changes.endArrowhead === "none" ? null : changes.endArrowhead,
                    }),
              }
            : {}),
          ...(kind === "text" && changes.textStyle !== undefined
            ? {
                strokeColor: changes.textStyle.color,
                fontSize: changes.textStyle.fontSize,
                fontFamily: fontFamilyValue(changes.textStyle.font),
                textAlign: changes.textStyle.textAlign,
                opacity: changes.textStyle.opacity,
              }
            : {}),
        };
        if (
          element.type === "text" &&
          changes.textStyle &&
          (element.fontSize !== changes.textStyle.fontSize ||
            element.fontFamily !== fontFamilyValue(changes.textStyle.font))
        ) {
          // Let Excalidraw measure the chosen local font, including explicit
          // line breaks. Reusing the old dimensions can clip a wider font.
          const [measured] = convertToExcalidrawElements([
            {
              type: "text",
              x: element.x,
              y: element.y,
              text: element.text,
              fontFamily: fontFamilyValue(changes.textStyle.font),
              fontSize: changes.textStyle.fontSize,
            } as never,
          ]);
          if (measured?.type === "text")
            return newElementWith(element, {
              ...patch,
              width: measured.width,
              height: measured.height,
              lineHeight: measured.lineHeight,
            } as never);
        }
        return newElementWith(element, patch as never);
      });
      api.updateScene({
        elements,
        captureUpdate: commit ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.EVENTUALLY,
      });
    }, []);

    useLayoutEffect(() => {
      applyDefaultStyle();
    }, [applyDefaultStyle, api, ready]);

    useEffect(() => {
      if (!api) return;
      try {
        return editorHistory(api).subscribe(props.onHistoryChange);
      } catch (error) {
        props.onHistoryChange(EMPTY_EDITOR_HISTORY);
        props.onError?.(String(error));
      }
    }, [api, props.onHistoryChange]);

    useEffect(() => {
      const api = apiRef.current;
      const base = baseCanvasRef.current;
      if (!api || !base) return;
      let cancelled = false;
      setReady(false);
      setFailed(false);
      mosaicActiveRef.current = false;
      setMosaicActive(false);
      void (async () => {
        const fileId = `dockmapper-capture-${props.captureKey}`;
        if (cancelled) return;
        const [background] = convertToExcalidrawElements([
          {
            ...captureBackgroundSkeleton(fileId, base.width, base.height),
            x: props.crop?.sourceX ?? 0,
            y: props.crop?.sourceY ?? 0,
          } as never,
        ]);
        api.updateScene({
          elements: [background],
          appState: { viewBackgroundColor: "transparent" } as never,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        alignViewportRef.current();
        if (!cancelled) {
          captureKeyRef.current = props.captureKey;
          cropRef.current = props.crop;
          api.history.clear();
          setReady(true);
          callbacksRef.current.onReady?.();
        }
      })().catch((cause: unknown) => {
        if (!cancelled) {
          setReady(false);
          setFailed(true);
          const detail = cause instanceof Error ? cause.message : String(cause);
          console.error("[screenshot-editor] 初始化失败", { detail });
          callbacksRef.current.onError?.(`截图编辑器初始化失败：${detail}`);
        }
      });
      return () => {
        cancelled = true;
      };
    }, [api, hasBaseCanvas, props.captureKey]);

    useEffect(() => {
      const api = apiRef.current;
      const previous = cropRef.current;
      const next = props.crop;
      if (!api || !ready || !previous || !next || captureKeyRef.current !== props.captureKey)
        return;
      if (
        previous.sourceX === next.sourceX &&
        previous.sourceY === next.sourceY &&
        previous.sourceWidth === next.sourceWidth &&
        previous.sourceHeight === next.sourceHeight &&
        previous.outputWidth === next.outputWidth &&
        previous.outputHeight === next.outputHeight
      )
        return;

      // Annotation coordinates remain anchored to the frozen screen. Only the viewport moves.
      const elements = api.getSceneElementsIncludingDeleted().map((element) =>
        element.id === `dockmapper-capture-${props.captureKey}`
          ? newElementWith(element, {
              x: next.sourceX,
              y: next.sourceY,
              width: next.outputWidth,
              height: next.outputHeight,
            })
          : element,
      );
      api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
      cropRef.current = next;
      alignViewport();
    }, [alignViewport, props.captureKey, props.crop, ready]);

    const handleApi = useCallback((nextApi: ExcalidrawImperativeAPI) => {
      apiRef.current = nextApi;
      setApi(nextApi);
    }, []);

    const handleChange = useCallback<NonNullable<ExcalidrawProps["onChange"]>>(
      (elements, appState) => {
        appStateRef.current = appState as unknown as Record<string, unknown>;
        scheduleAlignment();
        if (appState.activeTool.type === "line") {
          const capture = captureKeyRef.current;
          const editor = apiRef.current;
          queueMicrotask(() => {
            if (
              apiRef.current === editor &&
              captureKeyRef.current === capture &&
              editor?.getAppState().activeTool.type === "line"
            )
              editor.setActiveTool({ type: "arrow", locked: true });
          });
          return;
        }
        if (mosaicActiveRef.current && appState.activeTool.type !== "selection") {
          mosaicActiveRef.current = false;
          setMosaicActive(false);
        }
        const activeTool = resolveScreenshotTool(
          appState.activeTool.type,
          requestedToolRef.current,
          mosaicActiveRef.current,
        );
        const circles = elements.filter(isNumberBadgeBody);
        if (
          circles.length < previousNumberCount.current &&
          numberStyleRef.current.renumber !== false
        ) {
          previousNumberCount.current = circles.length;
          const editor = apiRef.current,
            capture = captureKeyRef.current;
          queueMicrotask(() => {
            if (
              !editor ||
              apiRef.current !== editor ||
              captureKeyRef.current !== capture ||
              !baseCanvasRef.current
            )
              return;
            const all = editor.getSceneElementsIncludingDeleted();
            const bodies = all.filter(isNumberBadgeBody);
            const zoom = editor.getAppState().zoom.value;
            const updated = replaceNumberBadges(
              all,
              bodies,
              baseCanvasRef.current,
              zoom,
              (body) => numberStyleForBadge(body, numberStyleRef.current, zoom),
              (_body, index) => (numberStyleRef.current.start ?? 1) + index,
            );
            editor.updateScene({
              elements: updated,
              captureUpdate: CaptureUpdateAction.EVENTUALLY,
            });
          });
        } else previousNumberCount.current = circles.length;
        const ids = numberGroupsToErase(elements);
        if (ids.size && requestedToolRef.current === "eraser") {
          apiRef.current?.updateScene({
            elements: elements.map((element) =>
              ids.has(element.id) ? newElementWith(element, { isDeleted: true }) : element,
            ),
            captureUpdate: CaptureUpdateAction.EVENTUALLY,
          });
        }
        if (reportedToolRef.current !== activeTool) {
          reportedToolRef.current = activeTool;
          toolCallbackRef.current?.(activeTool);
        }
        const selected = elements.filter(
          (element) => appState.selectedElementIds[element.id] && !element.locked,
        );
        const element = selected[0];
        const tool = annotationToolFromElement(element);
        const propertyValue = (candidate: (typeof selected)[number], property: string): unknown => {
          if (property === "strokeColor") return candidate.strokeColor;
          if (property === "strokeWidth") return candidate.strokeWidth;
          if (property === "lineStyle") return candidate.strokeStyle;
          if (property === "fillColor") return candidate.backgroundColor;
          if (property === "fillStyle") return candidate.fillStyle;
          if (property === "roughness") return candidate.roughness;
          if (property === "roundness") return candidate.roundness ? "round" : "sharp";
          if (property === "opacity") return candidate.opacity;
          if (property === "arrowStyle")
            return candidate.type === "arrow" ? arrowStyleFromElement(candidate) : undefined;
          if (property === "startArrowhead")
            return candidate.type === "arrow" ? candidate.startArrowhead : undefined;
          if (property === "endArrowhead")
            return candidate.type === "arrow" ? candidate.endArrowhead : undefined;
          if (property === "fontFamily")
            return candidate.type === "text" ? candidate.fontFamily : undefined;
          if (property === "fontSize")
            return candidate.type === "text" ? candidate.fontSize : undefined;
          if (property === "textAlign")
            return candidate.type === "text" ? candidate.textAlign : undefined;
          return undefined;
        };
        const comparable = [
          "strokeColor",
          "strokeWidth",
          "lineStyle",
          "fillColor",
          "fillStyle",
          "roughness",
          "roundness",
          "opacity",
          "arrowStyle",
          "startArrowhead",
          "endArrowhead",
          "fontFamily",
          "fontSize",
          "textAlign",
        ];
        const onlyNumbers =
          selected.length > 0 &&
          selected.every((element) => annotationToolFromElement(element) === "number");
        const numberCircle = onlyNumbers ? selected.find(isNumberBadgeBody) : undefined;
        const mixedProperties = onlyNumbers
          ? []
          : selected.length > 1
            ? comparable.filter((property) => {
                const first = propertyValue(selected[0], property);
                return selected
                  .slice(1)
                  .some((candidate) => propertyValue(candidate, property) !== first);
              })
            : [];
        const currentTextStyle = textStyleRef.current;
        const nextSelection: ExcalidrawSelectionState = element
          ? {
              tool,
              tools: selected
                .map(annotationToolFromElement)
                .filter((value): value is AnnotTool => value !== null),
              count: selected.length,
              numberStyle:
                onlyNumbers && numberCircle
                  ? numberStyleForBadge(numberCircle, numberStyleRef.current, appState.zoom.value)
                  : undefined,
              mixedProperties,
              strokeColor: element.strokeColor,
              strokeWidth: element.strokeWidth,
              lineStyle: element.strokeStyle as LineStyle,
              fillColor: element.backgroundColor,
              fillStyle: (element.backgroundColor === "transparent"
                ? "none"
                : element.fillStyle === "cross-hatch"
                  ? "cross_hatch"
                  : element.fillStyle) as FillStyle,
              roughness: element.roughness as Roughness,
              roundness: element.roundness ? "round" : "sharp",
              opacity: element.opacity,
              arrowStyle: element.type === "arrow" ? arrowStyleFromElement(element) : undefined,
              startArrowhead:
                element.type === "arrow" ? supportedArrowhead(element.startArrowhead) : undefined,
              endArrowhead:
                element.type === "arrow" ? supportedArrowhead(element.endArrowhead) : undefined,
              textStyle:
                element.type === "text"
                  ? {
                      ...currentTextStyle,
                      color: element.strokeColor,
                      fontSize: element.fontSize,
                      font: textFontFromValue(element.fontFamily),
                      textAlign: element.textAlign as TextStyle["textAlign"],
                      opacity: element.opacity,
                    }
                  : undefined,
            }
          : { tool: null, tools: [], count: 0, mixedProperties: [] };
        if (!isSameExcalidrawSelection(reportedSelectionRef.current, nextSelection)) {
          reportedSelectionRef.current = nextSelection;
          selectionCallbackRef.current?.(nextSelection);
        }
      },
      [scheduleAlignment],
    );

    useImperativeHandle(
      ref,
      () => ({
        clearSelection: () => {
          apiRef.current?.updateScene({
            appState: { selectedElementIds: {}, editingGroupId: null },
          });
        },
        hitTest: (clientX, clientY) => {
          const api = apiRef.current;
          if (!api) return false;
          const point = viewportCoordsToSceneCoords({ clientX, clientY }, api.getAppState());
          const margin = 5 / api.getAppState().zoom.value;
          const elements = api.getSceneElements();
          const selected = elements.filter(
            (element) => api.getAppState().selectedElementIds[element.id] && !element.locked,
          );
          if (selected.length) {
            const [left, top, right, bottom] = getCommonBounds(selected);
            const handleMargin = 40 / api.getAppState().zoom.value;
            if (
              point.x >= left - handleMargin &&
              point.x <= right + handleMargin &&
              point.y >= top - handleMargin &&
              point.y <= bottom + handleMargin
            )
              return true;
          }
          return elements.some((element) => annotationHitTest(element, point, margin));
        },
        exportPng: async (background) => {
          const api = apiRef.current;
          const base = background ?? props.baseCanvas;
          if (!api || !base || !ready) throw new Error("截图编辑器尚未准备完成");
          const annotationElements = api.getSceneElements().filter((element) => !element.locked);
          if (!annotationElements.length) {
            const original = await new Promise<Blob>((resolve, reject) =>
              base.toBlob(
                (value) => (value ? resolve(value) : reject(new Error("截图底图导出失败"))),
                "image/png",
              ),
            );
            return new Uint8Array(await original.arrayBuffer());
          }
          const annotations = await captureAnnotationCanvas(
            api,
            base,
            props.crop?.sourceX ?? 0,
            props.crop?.sourceY ?? 0,
          );
          const overlay = document.createElement("canvas");
          overlay.width = base.width;
          overlay.height = base.height;
          const context = overlay.getContext("2d");
          if (!context) throw new Error("标注层画布不可用");
          context.drawImage(base, 0, 0);
          context.drawImage(annotations, 0, 0);
          const result = await new Promise<Blob>((resolve, reject) =>
            overlay.toBlob(
              (value) => (value ? resolve(value) : reject(new Error("截图合成失败"))),
              "image/png",
            ),
          );
          return new Uint8Array(await result.arrayBuffer());
        },
        setTool: (tool) => {
          requestedToolRef.current = tool;
          mosaicActiveRef.current = tool === "mosaic";
          setMosaicActive(tool === "mosaic");
          const type = excalidrawToolType(tool);
          apiRef.current?.setActiveTool({ type, locked: type !== "selection" } as never);
          apiRef.current?.updateScene({
            appState: {
              ...(["mosaic", "number", "picker", "highlight"].includes(tool ?? "")
                ? { selectedElementIds: {} }
                : {}),
            } as never,
            captureUpdate: CaptureUpdateAction.EVENTUALLY,
          });
        },
        applyStyle: applySelectionStyle,
        undo: () => {
          const api = apiRef.current;
          if (api && editorHistory(api).getState().canUndo) editorHistory(api).undo();
        },
        redo: () => {
          const api = apiRef.current;
          if (api && editorHistory(api).getState().canRedo) editorHistory(api).redo();
        },
        isEditingText: () => Boolean(appStateRef.current.editingTextElement),
        getStatus: () => (failed ? "failed" : ready ? "ready" : "loading"),
      }),
      // Recropping reuses the base canvas. Refresh the exporter when its screen
      // origin changes so annotations are composited relative to the new crop.
      [
        applySelectionStyle,
        failed,
        props.baseCanvas,
        props.crop?.sourceX,
        props.crop?.sourceY,
        ready,
      ],
    );

    const presentation = screenshotEditorPresentation(ready);

    return (
      <div
        ref={rootRef}
        className="excalidraw-screenshot-editor"
        data-ready={presentation.dataReady}
        aria-hidden={presentation.ariaHidden}
        onWheelCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDownCapture={(event) => {
          if (event.button === 0) {
            // Capture before Excalidraw creates the new freedraw element.
            gestureIdsRef.current = new Set(
              apiRef.current?.getSceneElements().map((element) => element.id),
            );
          }
          if (event.button === 1) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <Excalidraw
          excalidrawAPI={handleApi}
          initialData={EXCALIDRAW_INITIAL_DATA}
          zenModeEnabled
          handleKeyboardGlobally
          autoFocus
          UIOptions={EXCALIDRAW_UI_OPTIONS}
          onPaste={rejectPaste}
          onChange={handleChange}
          onPointerUp={() => {
            const editor = apiRef.current;
            if (!editor || requestedToolRef.current !== "highlight") return;
            const capture = captureKeyRef.current;
            const baseline = gestureIdsRef.current;
            // The callback runs before the editor finishes the final point.
            queueMicrotask(() => {
              if (apiRef.current !== editor || captureKeyRef.current !== capture) return;
              const elements = editor.getSceneElements();
              if (
                !elements.some(
                  (element) => element.type === "freedraw" && !baseline.has(element.id),
                )
              )
                return;
              editor.updateScene({
                elements: elements.map((element) =>
                  element.type === "freedraw" && !baseline.has(element.id)
                    ? newElementWith(element, {
                        customData: { ...element.customData, dockmapperTool: "highlight" },
                      })
                    : element,
                ),
                captureUpdate: CaptureUpdateAction.EVENTUALLY,
              });
            });
          }}
        />
        {(props.tool === "picker" || props.tool === "number") &&
          ready &&
          !props.interactionDisabled &&
          api &&
          props.baseCanvas && (
            <SpecialToolLayer
              key={`${props.captureKey}:${props.tool}:${viewportRevision}`}
              tool={props.tool}
              api={api}
              base={props.baseCanvas}
              numberStyle={props.numberStyle}
              origin={{ x: props.crop?.sourceX ?? 0, y: props.crop?.sourceY ?? 0 }}
              format={props.pickerFormat}
              keyboardBlocked={props.pickerKeyboardBlocked}
              onCopyColor={props.onCopyColor}
              onError={props.onDrawingError ?? props.onError ?? console.error}
            />
          )}

        {mosaicActive && ready && !props.interactionDisabled && api && props.baseCanvas && (
          <MosaicDrawingLayer
            key={`${props.captureKey}:${viewportRevision}:${props.crop?.sourceX}:${props.crop?.sourceY}:${props.crop?.sourceWidth}:${props.crop?.sourceHeight}:${props.crop?.outputWidth}:${props.crop?.outputHeight}`}
            api={api}
            baseCanvas={props.baseCanvas}
            origin={{ x: props.crop?.sourceX ?? 0, y: props.crop?.sourceY ?? 0 }}
            blockSize={props.mosaicBlock}
            effect={props.mosaicEffect}
            blurRadius={props.blurRadius}
            captureKey={props.captureKey}
            onError={props.onDrawingError ?? props.onError}
          />
        )}
      </div>
    );
  },
);

export default ExcalidrawScreenshotEditor;
