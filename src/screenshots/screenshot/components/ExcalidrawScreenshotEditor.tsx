import {
  Excalidraw,
  CaptureUpdateAction,
  convertToExcalidrawElements,
  exportToBlob,
  newElementWith,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
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
  FillStyle,
  LineStyle,
  Roughness,
  TextStyle,
  ToolSettings,
} from "./annotationTypes";
import {
  captureBackgroundSkeleton,
  captureExportDimensions,
  excalidrawToolType,
  isSameExcalidrawSelection,
  screenshotEditorPresentation,
  type ExcalidrawSelectionState,
} from "./excalidrawScreenshotAdapter";

export interface ExcalidrawScreenshotEditorHandle {
  exportPng: () => Promise<Uint8Array>;
  setTool: (tool: AnnotTool) => void;
  applyStyle: (changes: ExcalidrawStyleChanges) => void;
  undo: () => void;
  redo: () => void;
  isEditingText: () => boolean;
}

export type ExcalidrawStyleChanges = Partial<Pick<
  ToolSettings,
  | "strokeColor"
  | "strokeWidth"
  | "fillColor"
  | "fillStyle"
  | "lineStyle"
  | "roughness"
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
  strokeColor: string;
  strokeWidth: number;
  fillColor: string;
  fillStyle: "none" | "solid" | "hachure" | "cross_hatch";
  lineStyle: "solid" | "dashed" | "dotted";
  roughness: 0 | 1 | 2;
  arrowStyle: ArrowStyle;
  startArrowhead: Arrowhead;
  endArrowhead: Arrowhead;
  textStyle: TextStyle;
  onReady?: () => void;
  onError?: (message: string) => void;
  onSelectionChange?: (selection: ExcalidrawSelectionState) => void;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("截图底图导出失败"))), "image/png"),
  );
}

function supportedArrowhead(value: unknown): Arrowhead {
  return value === "arrow" || value === "triangle" || value === "circle" ||
      value === "diamond" || value === "bar"
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
    callbacksRef.current = { onReady: props.onReady, onError: props.onError };
    selectionCallbackRef.current = props.onSelectionChange;
    const filesRef = useRef<Record<string, unknown>>({});
    const appStateRef = useRef<Record<string, unknown>>({});
    const [ready, setReady] = useState(false);
    const interactionRef = useRef("");
    const reportedSelectionRef = useRef<ExcalidrawSelectionState>({ tool: null, tools: [], count: 0 });

    const applyDefaultStyle = useCallback(() => {
      const api = apiRef.current;
      if (!api) return;
      const appState = {
          currentItemStrokeColor: props.strokeColor,
          currentItemBackgroundColor: props.fillStyle === "none" ? "transparent" : props.fillColor,
          currentItemFillStyle: props.fillStyle === "cross_hatch" ? "cross-hatch" : props.fillStyle,
          currentItemStrokeWidth: props.strokeWidth,
          currentItemStrokeStyle: props.lineStyle,
          currentItemRoughness: props.roughness,
          currentItemArrowType: props.arrowStyle === "round" || props.arrowStyle === "elbow"
            ? props.arrowStyle
            : "sharp",
          currentItemStartArrowhead: props.startArrowhead === "none" ? null : props.startArrowhead,
          currentItemEndArrowhead: props.endArrowhead === "none" ? null : props.endArrowhead,
          currentItemFontSize: props.textStyle.fontSize,
        currentItemFontFamily: props.textStyle.font === "mono" ? 3 : props.textStyle.font === "serif" ? 1 : 2,
      };
      api.updateScene({ appState: appState as never });
      console.debug("[screenshot-editor] 已更新新对象样式", {
        stroke: props.strokeColor,
        width: props.strokeWidth,
      });
    }, [props.arrowStyle, props.endArrowhead, props.fillColor, props.fillStyle, props.lineStyle, props.roughness, props.startArrowhead, props.strokeColor, props.strokeWidth, props.textStyle]);

    const applySelectionStyle = useCallback((changes: ExcalidrawStyleChanges) => {
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
                  : { fillStyle: changes.fillStyle === "cross_hatch" ? "cross-hatch" : changes.fillStyle }),
              }
            : {}),
          ...(isLinear && changes.lineStyle !== undefined ? { strokeStyle: changes.lineStyle } : {}),
          ...(isLinear && changes.roughness !== undefined ? { roughness: changes.roughness } : {}),
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
                fontFamily: changes.textStyle.font === "mono" ? 3 : changes.textStyle.font === "serif" ? 1 : 2,
              }
            : {}),
        };
        return newElementWith(element, patch as never);
      });
      api.updateScene({ elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      console.debug("[screenshot-editor] 已更新选中对象样式", { selectedCount, changes: Object.keys(changes) });
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
      console.debug("[screenshot-editor] 开始初始化", {
        captureKey: props.captureKey,
        width: base.width,
        height: base.height,
      });
      void (async () => {
        const fileId = `dockmapper-capture-${props.captureKey}`;
        const blob = await canvasBlob(base);
        if (cancelled) return;
        const file = new File([blob], "capture.png", { type: "image/png" });
        const dataURL = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error ?? new Error("截图底图读取失败"));
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(file);
        });
        if (cancelled) return;
        const binaryFile = {
          id: fileId,
          dataURL,
          mimeType: "image/png",
          created: Date.now(),
          lastRetrieved: Date.now(),
        };
        filesRef.current = { [fileId]: binaryFile };
        api.addFiles([binaryFile] as never);
        const [background] = convertToExcalidrawElements([
          captureBackgroundSkeleton(fileId, base.width, base.height) as never,
        ]);
        api.updateScene({
          elements: [background],
          appState: { viewBackgroundColor: "transparent" } as never,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        console.debug("[screenshot-editor] 底图已就绪", {
          captureKey: props.captureKey,
          width: base.width,
          height: base.height,
        });
        // CSS pixels can differ from the source bitmap on a high-DPI display;
        // fit the locked bitmap to the selected viewport without resampling it
        // for the exported PNG.
        api.scrollToContent(background, { fitToViewport: true, viewportZoomFactor: 1, animate: false });
        if (!cancelled) {
          setReady(true);
          console.debug("[screenshot-editor] 编辑器显示切换", { ready: true });
          callbacksRef.current.onReady?.();
        }
      })().catch((cause: unknown) => {
        if (!cancelled) {
          setReady(false);
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
      console.debug("[screenshot-editor] 内建 UI 已由截图作用域样式隐藏");
    }, []);

    useImperativeHandle(ref, () => ({
      exportPng: async () => {
        const api = apiRef.current;
        const base = props.baseCanvas;
        if (!api || !base || !ready) throw new Error("截图编辑器尚未准备完成");
        const blob = await exportToBlob({
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
        return new Uint8Array(await blob.arrayBuffer());
      },
      setTool: (tool) => {
        const type = excalidrawToolType(tool);
        apiRef.current?.updateScene({
          appState: { activeTool: { type, lastActiveTool: null, locked: type !== "selection" } } as never,
        });
        console.debug("[screenshot-editor] 切换工具", { tool, type, locked: type !== "selection" });
      },
      applyStyle: applySelectionStyle,
      undo: () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
      },
      redo: () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true }));
      },
      isEditingText: () => Boolean(appStateRef.current.editingTextElement),
    }), [applySelectionStyle, props.baseCanvas, ready]);

    const presentation = screenshotEditorPresentation(ready);

    return (
      <div
        className="excalidraw-screenshot-editor"
        data-ready={presentation.dataReady}
        aria-hidden={presentation.ariaHidden}
      >
        <Excalidraw
          excalidrawAPI={(api) => {
            apiRef.current = api;
            setApi(api);
          }}
          zenModeEnabled
          handleKeyboardGlobally
          autoFocus
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false } }}
          onPaste={() => false}
          onChange={(_elements, appState, files) => {
            appStateRef.current = appState as unknown as Record<string, unknown>;
            filesRef.current = files as unknown as Record<string, unknown>;
            const summary = `${appState.activeTool.type}:${appState.activeTool.locked}:${Object.keys(appState.selectedElementIds).length}`;
            if (interactionRef.current !== summary) {
              interactionRef.current = summary;
              console.debug("[screenshot-editor] 场景交互状态", {
                activeTool: appState.activeTool.type,
                locked: appState.activeTool.locked,
                selectedCount: Object.keys(appState.selectedElementIds).length,
              });
            }
            const selected = _elements.filter(
              (element) => appState.selectedElementIds[element.id] && !element.locked,
            );
            const element = selected[0];
            const tool = annotationToolFromElement(element);
            const nextSelection: ExcalidrawSelectionState = element
              ? {
                  tool,
                  tools: selected.map(annotationToolFromElement).filter((value): value is AnnotTool => value !== null),
                  count: selected.length,
                  strokeColor: element.strokeColor,
                  strokeWidth: element.strokeWidth,
                  lineStyle: element.strokeStyle as LineStyle,
                  fillColor: element.backgroundColor,
                  fillStyle: (element.fillStyle === "cross-hatch" ? "cross_hatch" : element.fillStyle) as FillStyle,
                  roughness: element.roughness as Roughness,
                  arrowStyle: element.type === "arrow" ? "sharp" : undefined,
                  startArrowhead: element.type === "arrow"
                    ? supportedArrowhead(element.startArrowhead)
                    : undefined,
                  endArrowhead: element.type === "arrow"
                    ? supportedArrowhead(element.endArrowhead)
                    : undefined,
                  textStyle: element.type === "text"
                    ? {
                        ...props.textStyle,
                        color: element.strokeColor,
                        fontSize: element.fontSize,
                        font: element.fontFamily === 3 ? "mono" : element.fontFamily === 1 ? "serif" : "sans",
                      }
                    : undefined,
                }
              : { tool: null, tools: [], count: 0 };
            if (!isSameExcalidrawSelection(reportedSelectionRef.current, nextSelection)) {
              reportedSelectionRef.current = nextSelection;
              selectionCallbackRef.current?.(nextSelection);
            }
          }}
        />
      </div>
    );
  },
);

export default ExcalidrawScreenshotEditor;
