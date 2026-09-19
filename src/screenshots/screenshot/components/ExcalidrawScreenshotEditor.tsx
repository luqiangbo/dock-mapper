import {
  Excalidraw,
  CaptureUpdateAction,
  FONT_FAMILY,
  convertToExcalidrawElements,
  exportToBlob,
  newElementWith,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, ExcalidrawProps } from "@excalidraw/excalidraw/types";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { AnnotTool } from "./AnnotationToolbar";
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
  captureExportDimensions,
  excalidrawCurrentItemRoundness,
  excalidrawRectangleRoundness,
  excalidrawToolType,
  isSameExcalidrawSelection,
  screenshotEditorPresentation,
  transformBetweenCrops,
  type ExcalidrawSelectionState,
} from "./excalidrawScreenshotAdapter";

export interface ExcalidrawScreenshotEditorHandle {
  exportPng: () => Promise<Uint8Array>;
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

export type ExcalidrawStyleChanges = Partial<Pick<
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
>>;

export type { ExcalidrawSelectionState } from "./excalidrawScreenshotAdapter";

interface Props {
  /** The already-cropped, physical-pixel screenshot canvas. */
  baseCanvas: HTMLCanvasElement | null;
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
  onReady?: () => void;
  onError?: (message: string) => void;
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
  appState: { viewBackgroundColor: "transparent" },
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
  return FONT_KEYS[font];
}

function textFontFromValue(value: number): TextStyle["font"] {
  const entry = Object.entries(FONT_KEYS).find(([key, family]) =>
    !["sans", "serif", "mono"].includes(key) && family === value
  );
  return (entry?.[0] as TextStyle["font"] | undefined) ?? "helvetica";
}

function arrowStyleFromElement(element: { elbowed?: boolean; roundness?: unknown }): ArrowStyle {
  if (element.elbowed) return "elbow";
  return element.roundness ? "round" : "sharp";
}

function toolFromActiveType(type: string): AnnotTool {
  return type === "rectangle" ? "rect"
    : type === "ellipse" ? "ellipse"
      : type === "diamond" ? "diamond"
        : type === "line" ? "line"
          : type === "arrow" ? "arrow"
            : type === "freedraw" ? "pen"
              : type === "text" ? "text"
                : type === "eraser" ? "eraser" : "select";
}

function supportedArrowhead(value: unknown): Arrowhead {
  return value === "arrow" || value === "triangle" || value === "triangle_outline" ||
      value === "circle" || value === "circle_outline" || value === "dot" ||
      value === "diamond" || value === "diamond_outline" || value === "bar" ||
      value === "crowfoot_one" || value === "crowfoot_many" || value === "crowfoot_one_or_many"
    ? value
    : "none";
}

function annotationToolFromElement(element: { type: string } | undefined): AnnotTool | null {
  return element?.type === "rectangle" ? "rect"
    : element?.type === "ellipse" ? "ellipse"
      : element?.type === "diamond" ? "diamond"
        : element?.type === "line" ? "line"
          : element?.type === "arrow" ? "arrow"
            : element?.type === "freedraw" ? "pen"
              : element?.type === "text" ? "text" : null;
}

/**
 * A deliberately small host adapter: Excalidraw owns drawing interaction and
 * history, while DockMapper owns capture lifecycle and image actions.
 */
const ExcalidrawScreenshotEditor = forwardRef<ExcalidrawScreenshotEditorHandle, Props>(
  function ExcalidrawScreenshotEditor(props, ref): React.JSX.Element {
    const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
    const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
    const callbacksRef = useRef({ onReady: props.onReady, onError: props.onError });
    const selectionCallbackRef = useRef(props.onSelectionChange);
    const toolCallbackRef = useRef(props.onToolChange);
    const textStyleRef = useRef(props.textStyle);
    callbacksRef.current = { onReady: props.onReady, onError: props.onError };
    selectionCallbackRef.current = props.onSelectionChange;
    toolCallbackRef.current = props.onToolChange;
    textStyleRef.current = props.textStyle;
    const appStateRef = useRef<Record<string, unknown>>({});
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const cropRef = useRef<ExcalidrawCrop | null>(null);
    const captureKeyRef = useRef("");
    const reportedToolRef = useRef<AnnotTool>("select");
    const reportedSelectionRef = useRef<ExcalidrawSelectionState>({ tool: null, tools: [], count: 0 });

    const applyDefaultStyle = useCallback(() => {
      const api = apiRef.current;
      if (!api) return;
      const appState = {
          currentItemStrokeColor: props.strokeColor,
          currentItemBackgroundColor: props.fillStyle === "none" ? "transparent" : props.fillColor,
          currentItemFillStyle: props.fillStyle === "none" ? "solid" : props.fillStyle === "cross_hatch" ? "cross-hatch" : props.fillStyle,
          currentItemStrokeWidth: props.strokeWidth,
          currentItemStrokeStyle: props.lineStyle,
          currentItemRoughness: props.roughness,
          currentItemArrowType: props.arrowStyle === "round" || props.arrowStyle === "elbow"
            ? props.arrowStyle
            : "sharp",
          currentItemStartArrowhead: props.startArrowhead === "none" ? null : props.startArrowhead,
          currentItemEndArrowhead: props.endArrowhead === "none" ? null : props.endArrowhead,
          currentItemFontSize: props.textStyle.fontSize,
          currentItemFontFamily: fontFamilyValue(props.textStyle.font),
          currentItemTextAlign: props.textStyle.textAlign,
          currentItemOpacity: props.opacity,
          currentItemRoundness: excalidrawCurrentItemRoundness(props.roundness),
      };
      api.updateScene({ appState: appState as never });
    }, [props.arrowStyle, props.endArrowhead, props.fillColor, props.fillStyle, props.lineStyle, props.opacity, props.roughness, props.roundness, props.startArrowhead, props.strokeColor, props.strokeWidth, props.textStyle]);

    const applySelectionStyle = useCallback((
      changes: ExcalidrawStyleChanges,
      commit = true,
    ) => {
      const api = apiRef.current;
      if (!api) return;
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
          ...(isFrame && (changes.fillColor !== undefined || changes.fillStyle !== undefined)
            ? {
                ...(changes.fillColor === undefined
                  ? {}
                  : { backgroundColor: changes.fillStyle === "none" ? "transparent" : changes.fillColor }),
                ...(changes.fillStyle === undefined
                  ? {}
                  : { fillStyle: changes.fillStyle === "none" ? "solid" : changes.fillStyle === "cross_hatch" ? "cross-hatch" : changes.fillStyle }),
              }
            : {}),
          ...(isLinear && changes.lineStyle !== undefined ? { strokeStyle: changes.lineStyle } : {}),
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
          ...(kind === "arrow" && (changes.startArrowhead !== undefined || changes.endArrowhead !== undefined)
            ? {
                ...(changes.startArrowhead === undefined
                  ? {}
                  : { startArrowhead: changes.startArrowhead === "none" ? null : changes.startArrowhead }),
                ...(changes.endArrowhead === undefined
                  ? {}
                  : { endArrowhead: changes.endArrowhead === "none" ? null : changes.endArrowhead }),
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
        return newElementWith(element, patch as never);
      });
      api.updateScene({
        elements,
        captureUpdate: commit ? CaptureUpdateAction.IMMEDIATELY : CaptureUpdateAction.NEVER,
      });
    }, []);

    useEffect(() => {
      applyDefaultStyle();
    }, [applyDefaultStyle]);

    useEffect(() => {
      const api = apiRef.current;
      const base = props.baseCanvas;
      if (!api || !base) return;
      let cancelled = false;
      setReady(false);
      setFailed(false);
      void (async () => {
        const fileId = `dockmapper-capture-${props.captureKey}`;
        if (cancelled) return;
        const [background] = convertToExcalidrawElements([
          captureBackgroundSkeleton(fileId, base.width, base.height) as never,
        ]);
        api.updateScene({
          elements: [background],
          appState: { viewBackgroundColor: "transparent" } as never,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        // CSS pixels can differ from the source bitmap on a high-DPI display;
        // fit the locked bitmap to the selected viewport without resampling it
        // for the exported PNG.
        api.scrollToContent(background, { fitToViewport: true, viewportZoomFactor: 1, animate: false });
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
    }, [api, props.baseCanvas, props.captureKey]);

    useEffect(() => {
      const api = apiRef.current;
      const previous = cropRef.current;
      const next = props.crop;
      if (!api || !ready || !previous || !next || captureKeyRef.current !== props.captureKey) return;
      if (
        previous.sourceX === next.sourceX && previous.sourceY === next.sourceY &&
        previous.sourceWidth === next.sourceWidth && previous.sourceHeight === next.sourceHeight &&
        previous.outputWidth === next.outputWidth && previous.outputHeight === next.outputHeight
      ) return;

      const transform = transformBetweenCrops(0, 0, previous, next);
      const { scaleX, scaleY } = transform;
      const elements = api.getSceneElements().map((element) => {
        if (element.locked) {
          return newElementWith(element, {
            x: 0,
            y: 0,
            width: next.outputWidth,
            height: next.outputHeight,
          } as never);
        }
        const position = transformBetweenCrops(element.x, element.y, previous, next);
        const points = "points" in element && Array.isArray(element.points)
          ? element.points.map(([pointX, pointY]) => [pointX * scaleX, pointY * scaleY])
          : undefined;
        return newElementWith(element, {
          x: position.x,
          y: position.y,
          width: element.width * scaleX,
          height: element.height * scaleY,
          ...(points ? { points } : {}),
          ...(element.type === "text" ? { fontSize: element.fontSize * scaleY } : {}),
        } as never);
      });
      const boundary = elements.find((element) => element.locked);
      api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
      api.history.clear();
      cropRef.current = next;
      if (boundary) {
        api.scrollToContent(boundary, { fitToViewport: true, viewportZoomFactor: 1, animate: false });
      }
    }, [props.captureKey, props.crop, ready]);

    const handleApi = useCallback((nextApi: ExcalidrawImperativeAPI) => {
      apiRef.current = nextApi;
      setApi(nextApi);
    }, []);

    const handleChange = useCallback<NonNullable<ExcalidrawProps["onChange"]>>(
      (elements, appState) => {
        appStateRef.current = appState as unknown as Record<string, unknown>;
        const activeTool = toolFromActiveType(appState.activeTool.type);
        if (reportedToolRef.current !== activeTool) {
          reportedToolRef.current = activeTool;
          toolCallbackRef.current?.(activeTool);
        }
        const selected = elements.filter(
          (element) => appState.selectedElementIds[element.id] && !element.locked,
        );
        const element = selected[0];
        const tool = annotationToolFromElement(element);
        const propertyValue = (candidate: typeof selected[number], property: string): unknown => {
          if (property === "strokeColor") return candidate.strokeColor;
          if (property === "strokeWidth") return candidate.strokeWidth;
          if (property === "lineStyle") return candidate.strokeStyle;
          if (property === "fillColor") return candidate.backgroundColor;
          if (property === "fillStyle") return candidate.fillStyle;
          if (property === "roughness") return candidate.roughness;
          if (property === "roundness") return candidate.roundness ? "round" : "sharp";
          if (property === "opacity") return candidate.opacity;
          if (property === "arrowStyle") return candidate.type === "arrow"
            ? arrowStyleFromElement(candidate)
            : undefined;
          if (property === "startArrowhead") return candidate.type === "arrow"
            ? candidate.startArrowhead
            : undefined;
          if (property === "endArrowhead") return candidate.type === "arrow"
            ? candidate.endArrowhead
            : undefined;
          if (property === "fontFamily") return candidate.type === "text"
            ? candidate.fontFamily
            : undefined;
          if (property === "fontSize") return candidate.type === "text"
            ? candidate.fontSize
            : undefined;
          if (property === "textAlign") return candidate.type === "text"
            ? candidate.textAlign
            : undefined;
          return undefined;
        };
        const comparable = [
          "strokeColor", "strokeWidth", "lineStyle", "fillColor", "fillStyle", "roughness",
          "roundness", "opacity", "arrowStyle", "startArrowhead", "endArrowhead",
          "fontFamily", "fontSize", "textAlign",
        ];
        const mixedProperties = selected.length > 1
          ? comparable.filter((property) => {
              const first = propertyValue(selected[0], property);
              return selected.slice(1).some((candidate) => propertyValue(candidate, property) !== first);
            })
          : [];
        const currentTextStyle = textStyleRef.current;
        const nextSelection: ExcalidrawSelectionState = element
          ? {
              tool,
              tools: selected.map(annotationToolFromElement).filter((value): value is AnnotTool => value !== null),
              count: selected.length,
              mixedProperties,
              strokeColor: element.strokeColor,
              strokeWidth: element.strokeWidth,
              lineStyle: element.strokeStyle as LineStyle,
              fillColor: element.backgroundColor,
              fillStyle: (element.backgroundColor === "transparent"
                ? "none"
                : element.fillStyle === "cross-hatch" ? "cross_hatch" : element.fillStyle) as FillStyle,
              roughness: element.roughness as Roughness,
              roundness: element.roundness ? "round" : "sharp",
              opacity: element.opacity,
              arrowStyle: element.type === "arrow" ? arrowStyleFromElement(element) : undefined,
              startArrowhead: element.type === "arrow" ? supportedArrowhead(element.startArrowhead) : undefined,
              endArrowhead: element.type === "arrow" ? supportedArrowhead(element.endArrowhead) : undefined,
              textStyle: element.type === "text"
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
      [],
    );

    useImperativeHandle(ref, () => ({
      exportPng: async () => {
        const api = apiRef.current;
        const base = props.baseCanvas;
        if (!api || !base || !ready) throw new Error("截图编辑器尚未准备完成");
        const annotationElements = api.getSceneElements().filter((element) => !element.locked);
        if (!annotationElements.length) {
          const original = await new Promise<Blob>((resolve, reject) =>
            base.toBlob((value) => value ? resolve(value) : reject(new Error("截图底图导出失败")), "image/png"),
          );
          return new Uint8Array(await original.arrayBuffer());
        }
        const blob = await exportToBlob({
          // Keep the transparent locked boundary in the export scene so
          // Excalidraw preserves absolute screenshot coordinates.
          elements: api.getSceneElements(),
          files: api.getFiles(),
          appState: {
            ...appStateRef.current,
            exportBackground: false,
            exportWithDarkMode: false,
            exportEmbedScene: false,
          } as never,
          getDimensions: () => captureExportDimensions(base.width, base.height),
          exportPadding: 0,
          mimeType: "image/png",
        });
        const overlay = document.createElement("canvas");
        overlay.width = base.width;
        overlay.height = base.height;
        const context = overlay.getContext("2d");
        if (!context) throw new Error("标注层画布不可用");
        context.drawImage(base, 0, 0);
        const image = new Image();
        const objectUrl = URL.createObjectURL(blob);
        try {
          image.src = objectUrl;
          await image.decode();
          context.drawImage(image, 0, 0, base.width, base.height);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
        const result = await new Promise<Blob>((resolve, reject) =>
          overlay.toBlob((value) => value ? resolve(value) : reject(new Error("截图合成失败")), "image/png"),
        );
        return new Uint8Array(await result.arrayBuffer());
      },
      setTool: (tool) => {
        const type = excalidrawToolType(tool);
        apiRef.current?.updateScene({
          appState: { activeTool: { type, lastActiveTool: null, locked: type !== "selection" } } as never,
        });
      },
      applyStyle: applySelectionStyle,
      undo: () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
      },
      redo: () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true }));
      },
      isEditingText: () => Boolean(appStateRef.current.editingTextElement),
      getStatus: () => failed ? "failed" : ready ? "ready" : "loading",
    }), [applySelectionStyle, failed, props.baseCanvas, ready]);

    const presentation = screenshotEditorPresentation(ready);

    return (
      <div
        className="excalidraw-screenshot-editor"
        data-ready={presentation.dataReady}
        aria-hidden={presentation.ariaHidden}
        onWheelCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDownCapture={(event) => {
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
        />
      </div>
    );
  },
);

export default ExcalidrawScreenshotEditor;
