import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { X, Maximize, Minimize, Plus, Minus, Scan, Square } from "lucide-react";
import { historyApi, errorMessage } from "../api/commands";
import type { HistoryPreviewSession } from "../api/ipc";
import { useWindowTheme } from "../hooks/useWindowTheme";
import { usePreviewImage } from "./usePreviewImage";
import {
  constrainView,
  fitView,
  zoomAt,
  escapeAction,
  type ImageView,
  type Size,
} from "./viewGeometry";
import "./preview.scss";

const initialView: ImageView = { scale: 1, x: 0, y: 0, mode: "fit" };

export default function HistoryPreview() {
  const { resolved } = useWindowTheme();
  const [session, setSession] = useState<HistoryPreviewSession | null>(null);
  const sessionGeneration = useRef(0);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [windowBusy, setWindowBusy] = useState(false);
  const windowOperation = useRef(false);
  const [stageSize, setStageSize] = useState<Size>({ width: 1, height: 1 });
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(initialView);
  const pan = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    view: ImageView;
  } | null>(null);
  const { image, error, retry } = usePreviewImage(session);
  useEffect(() => {
    void getCurrentWindow()
      .setTheme(resolved)
      .catch((error) => setOperationError(errorMessage(error)));
  }, [resolved]);
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    const accept = (next: HistoryPreviewSession | null) => {
      if (!disposed && next && next.generation > sessionGeneration.current) {
        sessionGeneration.current = next.generation;
        pan.current = null;
        setView(initialView);
        setSession(next);
        setSessionError(null);
      }
    };
    setSessionError(null);
    void listen<HistoryPreviewSession>("history-preview-session", ({ payload }) => accept(payload))
      .then(async (unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        off = unlisten;
        const current = await historyApi.previewSession();
        if (!current && !disposed && !sessionGeneration.current)
          setSessionError("没有可预览的截图，请从历史页重新打开。");
        accept(current);
      })
      .catch((error) => {
        if (!disposed) setSessionError(errorMessage(error));
      });
    return () => {
      disposed = true;
      off?.();
    };
  }, [sessionAttempt]);
  useLayoutEffect(() => {
    const node = stage.current;
    if (!node) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = node.clientWidth,
          height = node.clientHeight;
        setStageSize((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height },
        );
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  useLayoutEffect(() => {
    if (!image) return;
    setView((previous) =>
      previous.mode === "fit"
        ? fitView(stageSize, image.size)
        : constrainView(previous, stageSize, image.size),
    );
  }, [image, stageSize]);
  const windowAction = useCallback(async (action: "fullscreen" | "escape" | "close") => {
    if (windowOperation.current) return;
    windowOperation.current = true;
    setWindowBusy(true);
    setOperationError(null);
    try {
      const window = getCurrentWindow();
      const active = await window.isFullscreen();
      if (action === "close" || (action === "escape" && escapeAction(active) === "close"))
        await window.close();
      else {
        await window.setFullscreen(action === "escape" ? false : !active);
        setFullscreen(action === "escape" ? false : !active);
      }
    } catch (error) {
      setOperationError(`窗口操作失败：${errorMessage(error)}`);
    } finally {
      windowOperation.current = false;
      setWindowBusy(false);
    }
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "F11" || event.key === "Escape") {
        event.preventDefault();
        void windowAction(event.key === "F11" ? "fullscreen" : "escape");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [windowAction]);
  const zoom = useCallback(
    (factor: number) => {
      if (image)
        setView((previous) =>
          zoomAt(previous, stageSize, image.size, previous.scale * factor, { x: 0, y: 0 }),
        );
    },
    [image, stageSize],
  );
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!image) return;
      const rect = node.getBoundingClientRect();
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      const factor = Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.002);
      setView((previous) =>
        zoomAt(previous, stageSize, image.size, previous.scale * factor, {
          x: event.clientX - rect.left - rect.width / 2,
          y: event.clientY - rect.top - rect.height / 2,
        }),
      );
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [image, stageSize]);
  return (
    <main className="history-preview">
      <header className="preview-toolbar">
        <div
          className="preview-title"
          onPointerDown={(event) => {
            if (event.button === 0 && !fullscreen)
              void getCurrentWindow()
                .startDragging()
                .catch((error) => setOperationError(errorMessage(error)));
          }}
        >
          截图原图
        </div>
        <div className="preview-tools">
          <button aria-label="缩小" title="缩小" disabled={!image} onClick={() => zoom(1 / 1.2)}>
            <Minus />
          </button>
          <output aria-label="缩放比例">
            {image ? `${(view.scale * 100).toFixed(view.scale < 0.1 ? 1 : 0)}%` : "—"}
          </output>
          <button aria-label="放大" title="放大" disabled={!image} onClick={() => zoom(1.2)}>
            <Plus />
          </button>
          <button
            aria-label="适应窗口"
            title="适应窗口"
            disabled={!image}
            onClick={() => image && setView(fitView(stageSize, image.size))}
          >
            <Scan />
            <span>适应</span>
          </button>
          <button
            aria-label="原始大小"
            title="原始大小"
            disabled={!image}
            onClick={() => setView({ ...initialView, mode: "manual" })}
          >
            <Square />
            <span>原始</span>
          </button>
          <button
            aria-label={fullscreen ? "退出全屏" : "全屏"}
            title="全屏（F11）"
            disabled={windowBusy}
            onClick={() => void windowAction("fullscreen")}
          >
            {fullscreen ? <Minimize /> : <Maximize />}
          </button>
        </div>
        <button
          className="preview-close"
          aria-label="关闭预览"
          title="关闭"
          disabled={windowBusy}
          onClick={() => void windowAction("close")}
        >
          <X />
        </button>
      </header>
      {operationError && (
        <div className="preview-operation-error" role="alert">
          {operationError}
          <button onClick={() => setOperationError(null)}>关闭提示</button>
        </div>
      )}
      <div
        ref={stage}
        className={`preview-stage ${image ? "has-image" : ""}`}
        role="region"
        aria-label="原图，可滚轮缩放和拖动"
        onDoubleClick={() =>
          image &&
          setView((previous) =>
            previous.mode === "fit"
              ? { ...initialView, mode: "manual" }
              : fitView(stageSize, image.size),
          )
        }
        onPointerDown={(event) => {
          if (event.button !== 0 || !image || (event.target as HTMLElement).closest("button"))
            return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pan.current = {
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            view,
          };
        }}
        onPointerMove={(event) => {
          const current = pan.current;
          if (!current || current.pointerId !== event.pointerId || !image) return;
          if (Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) < 2)
            return;
          setView(
            constrainView(
              {
                ...current.view,
                x: current.view.x + event.clientX - current.clientX,
                y: current.view.y + event.clientY - current.clientY,
                mode: "manual",
              },
              stageSize,
              image.size,
            ),
          );
        }}
        onPointerUp={() => {
          pan.current = null;
        }}
        onPointerCancel={() => {
          pan.current = null;
        }}
        onLostPointerCapture={() => {
          pan.current = null;
        }}
      >
        {sessionError || error ? (
          <div className="preview-state" role="alert">
            <strong>原图加载失败</strong>
            <p>{sessionError || error}</p>
            <button
              onClick={() => (sessionError ? setSessionAttempt((value) => value + 1) : retry())}
            >
              重试
            </button>
          </div>
        ) : image ? (
          <img
            src={image.url}
            alt="截图原图"
            draggable={false}
            style={{
              width: image.size.width,
              height: image.size.height,
              transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px)) scale(${view.scale})`,
            }}
          />
        ) : (
          <div className="preview-state" role="status">
            正在加载原图…
          </div>
        )}
      </div>
      <footer className="preview-hint">滚轮缩放 · 拖动查看 · 双击切换比例</footer>
      {!fullscreen &&
        ["North", "NorthEast", "East", "SouthEast", "South", "SouthWest", "West", "NorthWest"].map(
          (direction) => (
            <div
              key={direction}
              className={`preview-resize resize-${direction}`}
              onPointerDown={(event) => {
                if (event.button === 0)
                  void getCurrentWindow()
                    .startResizeDragging(direction as "North")
                    .catch((error) => setOperationError(errorMessage(error)));
              }}
            />
          ),
        )}
    </main>
  );
}
