import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { copyBinaryPayload } from "../utils/binaryPayload";
import { invokeCommand, type PinActionCommand } from "../../../api/ipc";
import type { PinOptions } from "../../../api/screenshotTypes";
import { usePinZoomController } from "../hooks/usePinZoomController";
import { createLatestWriter } from "../../../utils/latestWriter";
import { clampMenuPosition } from "./menuGeometry";

export default function PinImage(): React.JSX.Element {
  const pinId = new URLSearchParams(window.location.search).get("id") ?? getCurrentWindow().label;
  const [imageUrl, setImageUrl] = useState("");
  const [loadError, setLoadError] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [optionsReady, setOptionsReady] = useState(false);
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const [savingOptions, setSavingOptions] = useState(false);
  const [options, setOptions] = useState<PinOptions>({
    opacity: 1,
    locked: false,
  });
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const imageUrlRef = useRef("");
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuLayout, setMenuLayout] = useState({ left: 8, top: 8 });
  const mountedRef = useRef(true);
  const confirmedOptionsRef = useRef(options);
  const draftOptionsRef = useRef<PinOptions | null>(null);
  const writer = useMemo(
    () =>
      createLatestWriter<PinOptions, PinOptions>({
        save: (next) =>
          invokeCommand("update_pin_options", {
            id: pinId,
            opacity: next.opacity,
            locked: next.locked,
          }),
        onSaved: (saved, latest) => {
          if (!mountedRef.current) return;
          confirmedOptionsRef.current = saved;
          if (latest) {
            setOptions(saved);
            setOptionsError("");
            draftOptionsRef.current = null;
          }
        },
        onError: (error, latest) => {
          if (!mountedRef.current) return;
          setOptionsError(`贴图设置未保存：${String(error)}`);
          if (latest) setOptions(confirmedOptionsRef.current);
        },
        onBusyChange: (busy) => {
          if (mountedRef.current) setSavingOptions(busy);
        },
      }),
    [pinId],
  );
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      writer.cancelPending();
    };
  }, [writer]);
  useLayoutEffect(() => {
    if (!menuPosition || !menuRef.current) return;
    const measure = () => {
      const menu = menuRef.current;
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      const next = clampMenuPosition(menuPosition, rect, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      setMenuLayout((previous) =>
        previous.left === next.left && previous.top === next.top ? previous : next,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(menuRef.current);
    measure();
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [menuPosition]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuPosition(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  const { onWheel: scaleAtPointer, zoomError } = usePinZoomController(
    pinId,
    optionsReady && !options.locked,
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let revision = 0;

    const refreshImage = async (): Promise<void> => {
      const request = ++revision;
      try {
        // `tauri::ipc::Response` is delivered to JavaScript as an ArrayBuffer.
        // Normalize it instead of relying on the invoke generic, which only
        // affects TypeScript and does not convert the runtime value.
        const png = await invokeCommand("get_pin_image", { id: pinId });
        const pngBuffer = copyBinaryPayload(png);
        if (disposed || request !== revision) return;
        const nextUrl = URL.createObjectURL(new Blob([pngBuffer], { type: "image/png" }));
        if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = nextUrl;
        setLoadError("");
        setImageUrl(nextUrl);
      } catch (error) {
        if (disposed || request !== revision) return;
        const detail = error instanceof Error ? error.message : String(error);
        setLoadError(`贴图加载失败：${detail}`);
      }
    };

    // Register first, then request current data. This closes the race between
    // the hidden prewarmed renderer loading and the first pin operation.
    void listen<string>("pin-image-updated", ({ payload }) => {
      if (payload === pinId) void refreshImage();
    })
      .then((off) => {
        if (disposed) {
          off();
          return;
        }
        unlisten = off;
        void refreshImage();
      })
      .catch((error) => {
        if (!disposed) setLoadError(`贴图监听失败：${String(error)}`);
      });

    return () => {
      disposed = true;
      unlisten?.();
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = "";
    };
  }, [pinId, reloadAttempt]);

  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    setOptionsReady(false);
    setOptionsError("");
    void listen<{ id: string; options: PinOptions }>("pin-options-changed", ({ payload }) => {
      if (payload.id === pinId && !disposed && !writer.isBusy()) {
        confirmedOptionsRef.current = payload.options;
        setOptions(payload.options);
        setOptionsReady(true);
      }
    })
      .then(async (unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        off = unlisten;
        const value = await invokeCommand("get_pin_options", { id: pinId });
        if (!disposed && !writer.isBusy()) {
          confirmedOptionsRef.current = value;
          setOptions(value);
          setOptionsReady(true);
        }
      })
      .catch((error) => {
        if (!disposed) setOptionsError("贴图设置读取失败：" + String(error));
      });
    return () => {
      disposed = true;
      off?.();
    };
  }, [pinId, writer, reloadAttempt]);

  const startDragging = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (menuPosition && !(event.target as HTMLElement).closest(".pin-menu")) {
      setMenuPosition(null);
      return;
    }
    if (
      !optionsReady ||
      options.locked ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest("button, .pin-menu")
    )
      return;
    event.preventDefault();
    void getCurrentWindow()
      .startDragging()
      .catch((error) => setLoadError(`移动贴图失败：${String(error)}`));
  };

  const updateOptions = (next: PinOptions): void => {
    draftOptionsRef.current = next;
    setOptions(next);
    setOptionsError("");
    writer.write(next);
  };

  const runPinCommand = async (command: PinActionCommand): Promise<void> => {
    try {
      await invokeCommand(command, { id: pinId });
      if (command !== "close_pin_window") setMenuPosition(null);
    } catch (error) {
      setLoadError(`贴图操作失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div
      className={`pin-wrap${loadError || zoomError || optionsError ? " pin-wrap-error" : ""}`}
      onPointerDown={startDragging}
      onWheel={scaleAtPointer}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuPosition({
          left: event.clientX,
          top: event.clientY,
        });
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          draggable={false}
          style={{ opacity: options.opacity }}
          onLoad={() => {
            setLoadError("");
            void invokeCommand("pin_image_ready", { id: pinId }).catch((error) => {
              setLoadError(
                `贴图显示失败：${error instanceof Error ? error.message : String(error)}`,
              );
            });
          }}
          onError={() => setLoadError("贴图加载失败：无法解码 PNG 图片")}
        />
      ) : null}
      {options.locked && <span className="pin-lock-status">已锁定</span>}
      {loadError || zoomError || optionsError ? (
        <div className="pin-load-error" role="alert">
          {loadError || zoomError || optionsError}
          {(loadError || (optionsError && !optionsReady)) && (
            <button
              type="button"
              onClick={() => {
                setLoadError("");
                setReloadAttempt((attempt) => attempt + 1);
              }}
            >
              重新读取
            </button>
          )}
        </div>
      ) : null}
      {menuPosition ? (
        <div
          className="pin-menu"
          ref={menuRef}
          style={menuLayout}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <label>
            <span role="status">
              {optionsError
                ? optionsReady
                  ? "保存失败"
                  : "读取失败"
                : !optionsReady
                  ? "正在读取…"
                  : savingOptions
                    ? "正在保存…"
                    : "已保存"}
            </span>
            {optionsError && draftOptionsRef.current && (
              <button
                type="button"
                onClick={() => {
                  if (draftOptionsRef.current) updateOptions(draftOptionsRef.current);
                }}
              >
                重试保存
              </button>
            )}
            <span>透明度 {Math.round(options.opacity * 100)}%</span>
            <input
              type="range"
              min="20"
              max="100"
              step="5"
              disabled={!optionsReady}
              value={Math.round(options.opacity * 100)}
              onChange={(event) =>
                void updateOptions({ ...options, opacity: Number(event.target.value) / 100 })
              }
            />
          </label>
          <button
            type="button"
            disabled={!optionsReady}
            onClick={() => void updateOptions({ ...options, locked: !options.locked })}
          >
            {options.locked ? "解除锁定" : "锁定位置"}
          </button>
          <button type="button" onClick={() => void runPinCommand("copy_pin_image")}>
            复制图片
          </button>
          <button type="button" onClick={() => void runPinCommand("save_pin_image")}>
            保存图片
          </button>
          <button type="button" onClick={() => void runPinCommand("close_pin_window")}>
            关闭贴图
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="pin-close"
        aria-label="关闭贴图"
        title="关闭贴图"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => void runPinCommand("close_pin_window")}
      >
        ×
      </button>
    </div>
  );
}
