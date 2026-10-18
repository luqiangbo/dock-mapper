import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { Alert, Button, Spin } from "antd";
import {
  exportToCanvas,
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { captureExportDimensions } from "./excalidrawScreenshotAdapter";
import { formatPickerColor, type ColorCopyFormat, type PickerSample } from "./pickerColor";
import {
  INITIAL_PICKER_STATE,
  pickerKeyAction,
  pickerReducer,
  type PixelPoint,
} from "./pickerState";
import { PickerPanel } from "./PickerPanel";

interface Props {
  api: ExcalidrawImperativeAPI;
  base: HTMLCanvasElement;
  format: ColorCopyFormat;
  keyboardBlocked?: boolean;
  onCopyColor: (color: string, formatted: string) => Promise<void>;
}
export function PickerLayer({ api, base, format, onCopyColor, keyboardBlocked = false }: Props) {
  const [state, dispatch] = useReducer(pickerReducer, INITIAL_PICKER_STATE);
  const [image, setImage] = useState<HTMLCanvasElement | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [anchor, setAnchor] = useState<PixelPoint>({ x: 0, y: 0 });
  const active = useRef(true);
  const copyingRef = useRef(false);
  const latest = useRef({ state, image, format, onCopyColor });
  latest.current = { state, image, format, onCopyColor };
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let disposed = false,
      revision = 0,
      previous: string | null = null;
    const refresh = () => {
      const elements = api.getSceneElements();
      const key = elements
        .map((element) => `${element.id}:${element.version}:${element.versionNonce}`)
        .join("|");
      if (key === previous) return;
      previous = key;
      const request = ++revision;
      setImage(null);
      setPrepareError(null);
      setCopied(false);
      void (async () => {
        const annotations = await exportToCanvas({
          elements,
          files: api.getFiles(),
          appState: { ...api.getAppState(), exportBackground: false, exportWithDarkMode: false },
          exportPadding: 0,
          getDimensions: () => captureExportDimensions(base.width, base.height),
        });
        if (disposed || revision !== request) return;
        const canvas = document.createElement("canvas");
        canvas.width = base.width;
        canvas.height = base.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("取色画布不可用");
        context.drawImage(base, 0, 0);
        context.drawImage(annotations, 0, 0, base.width, base.height);
        setImage(canvas);
      })().catch((error) => {
        if (!disposed && revision === request) setPrepareError(String(error));
      });
    };
    refresh();
    const off = api.onChange(refresh);
    return () => {
      disposed = true;
      revision += 1;
      off();
    };
  }, [api, base, attempt]);
  useEffect(() => {
    setCopied(false);
    setCopyError(null);
  }, [state.point?.x, state.point?.y, format, image]);
  const sampleAt = (source: HTMLCanvasElement, point: PixelPoint): PickerSample => {
    const context = source.getContext("2d");
    if (!context) throw new Error("取色画布不可用");
    const [red, green, blue] = context.getImageData(point.x, point.y, 1, 1).data;
    const hex = [red, green, blue]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    return { hex, red, green, blue, imageX: point.x, imageY: point.y, left: 0, top: 0 };
  };
  // Read only after the point or composite changes, never from the displayed magnifier.
  const [sample, setSample] = useState<PickerSample | null>(null);
  useLayoutEffect(() => {
    setSampleError(null);
    if (!image || !state.point) {
      setSample(null);
      return;
    }
    try {
      setSample(sampleAt(image, state.point));
    } catch (error) {
      setSample(null);
      setSampleError(String(error));
    }
  }, [image, state.point?.x, state.point?.y]);
  const copy = () => {
    const current = latest.current;
    if (
      current.state.mode !== "locked" ||
      !current.state.point ||
      !current.image ||
      copyingRef.current
    )
      return;
    const point = current.state.point,
      source = current.image,
      selectedFormat = current.format;
    copyingRef.current = true;
    setCopying(true);
    setCopyError(null);
    void (async () => {
      const value = sampleAt(source, point);
      await current.onCopyColor(`#${value.hex}`, formatPickerColor(value, selectedFormat));
      const now = latest.current;
      if (
        active.current &&
        now.image === source &&
        now.state.point?.x === point.x &&
        now.state.point?.y === point.y &&
        now.format === selectedFormat
      )
        setCopied(true);
    })()
      .catch((error) => {
        if (active.current) setCopyError(`复制失败：${String(error)}`);
      })
      .finally(() => {
        copyingRef.current = false;
        if (active.current) setCopying(false);
      });
  };
  const action = useRef(copy);
  action.current = copy;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      const textInput =
        target instanceof Element &&
        Boolean(
          target.closest(
            'input, textarea, [contenteditable="true"], [role="slider"], [role="combobox"], .ant-color-picker, .ant-select-dropdown',
          ),
        );
      const button = target instanceof Element && Boolean(target.closest("button"));
      const key = pickerKeyAction(event, textInput, button, keyboardBlocked);
      if (!key || event.keyCode === 229) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (key === "copy") action.current();
      else if (key === "toggle") dispatch({ type: "toggle" });
      else {
        const [dx, dy] = ({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const)[
          key
        ];
        dispatch({ type: "nudge", dx, dy, width: base.width, height: base.height });
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [base, keyboardBlocked]);
  const point = state.point
    ? sceneCoordsToViewportCoords(
        { sceneX: state.point.x + 0.5, sceneY: state.point.y + 0.5 },
        api.getAppState(),
      )
    : null;
  const readPointer = (clientX: number, clientY: number, lock: boolean) => {
    if (!image) return;
    const pixel = viewportCoordsToSceneCoords({ clientX, clientY }, api.getAppState());
    setAnchor({ x: clientX, y: clientY });
    dispatch({
      type: lock ? "lock" : "hover",
      point: pixel,
      width: base.width,
      height: base.height,
    });
  };
  return (
    <div
      className="screenshot-special-layer"
      aria-label="取色区域，单击锁定像素"
      onKeyDown={(event) => {
        if (
          (event.key === "Enter" || event.key === " ") &&
          event.target instanceof Element &&
          event.target.closest("[data-picker-controls]")
        )
          event.stopPropagation();
      }}
      onPointerMove={(event) => {
        if (state.mode === "following") readPointer(event.clientX, event.clientY, false);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        readPointer(event.clientX, event.clientY, true);
      }}
    >
      {prepareError || sampleError ? (
        <Alert
          className="special-tool-feedback"
          data-picker-controls
          type="error"
          title="取色准备失败"
          description={prepareError ?? sampleError}
          action={
            <Button
              size="small"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setAttempt((value) => value + 1)}
            >
              重试
            </Button>
          }
        />
      ) : !image ? (
        <div className="special-tool-feedback">
          <Spin size="small" />
          正在准备取色…
        </div>
      ) : !sample ? (
        <div className="special-tool-feedback">移动鼠标预览，单击锁定像素</div>
      ) : null}
      {sample && image && (
        <>
          {point && (
            <div className="picker-reticle" style={{ left: point.x, top: point.y }} aria-hidden>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path d="M16 2V10M16 22V30M2 16H10M22 16H30" stroke="#101317" strokeWidth="3" />
                <path d="M16 2V10M16 22V30M2 16H10M22 16H30" stroke="white" strokeWidth="1" />
                <rect x="13" y="13" width="6" height="6" stroke="#101317" strokeWidth="3" />
                <rect x="13" y="13" width="6" height="6" stroke="white" strokeWidth="1" />
              </svg>
            </div>
          )}
          <PickerPanel
            image={image}
            sample={sample}
            formatted={formatPickerColor(sample, format)}
            anchor={anchor}
            locked={state.mode === "locked"}
            copying={copying}
            copied={copied}
            error={copyError}
            nudge={(dx, dy) =>
              dispatch({ type: "nudge", dx, dy, width: base.width, height: base.height })
            }
            copy={copy}
            follow={() => dispatch({ type: "toggle" })}
          />
        </>
      )}
    </div>
  );
}
