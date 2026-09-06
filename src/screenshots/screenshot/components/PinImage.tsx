import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { copyBinaryPayload } from "../utils/binaryPayload";

interface PinOptions {
  opacity: number;
  locked: boolean;
}

export default function PinImage(): React.JSX.Element {
  const pinId = new URLSearchParams(window.location.search).get("id") ?? getCurrentWindow().label;
  const [imageUrl, setImageUrl] = useState("");
  const [loadError, setLoadError] = useState("");
  const [options, setOptions] = useState<PinOptions>({
    opacity: 1,
    locked: false,
  });
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const imageUrlRef = useRef("");
  const scaleFrame = useRef<number | null>(null);
  const pendingScale = useRef<{ factor: number; anchorX: number; anchorY: number } | null>(null);
  const scaleInFlight = useRef(false);
  const scaleDisposed = useRef(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const refreshImage = async (): Promise<void> => {
      try {
        // `tauri::ipc::Response` is delivered to JavaScript as an ArrayBuffer.
        // Normalize it instead of relying on the invoke generic, which only
        // affects TypeScript and does not convert the runtime value.
        const png = await invoke<unknown>("get_pin_image", { id: pinId });
        const pngBuffer = copyBinaryPayload(png);
        if (disposed) return;
        const nextUrl = URL.createObjectURL(new Blob([pngBuffer], { type: "image/png" }));
        if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
        imageUrlRef.current = nextUrl;
        setLoadError("");
        setImageUrl(nextUrl);
      } catch (error) {
        if (disposed) return;
        const detail = error instanceof Error ? error.message : String(error);
        setLoadError(`贴图加载失败：${detail}`);
      }
    };

    // Register first, then request current data. This closes the race between
    // the hidden prewarmed renderer loading and the first pin operation.
    void listen<string>("pin-image-updated", ({ payload }) => {
      if (payload === pinId) void refreshImage();
    }).then((off) => {
      if (disposed) {
        off();
        return;
      }
      unlisten = off;
      void refreshImage();
    });

    return () => {
      disposed = true;
      unlisten?.();
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = "";
    };
  }, [pinId]);

  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    void listen<{ id: string; options: PinOptions }>("pin-options-changed", ({ payload }) => {
      if (payload.id === pinId && !disposed) setOptions(payload.options);
    })
      .then(async (unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        off = unlisten;
        const value = await invoke<PinOptions>("get_pin_options", { id: pinId });
        if (!disposed) setOptions(value);
      })
      .catch((error) => {
        if (!disposed) setLoadError("贴图设置读取失败：" + String(error));
      });
    return () => {
      disposed = true;
      off?.();
    };
  }, [pinId]);

  useEffect(() => {
    scaleDisposed.current = false;
    return () => {
      scaleDisposed.current = true;
      if (scaleFrame.current !== null) cancelAnimationFrame(scaleFrame.current);
      scaleFrame.current = null;
      pendingScale.current = null;
    };
  }, [pinId]);

  const startDragging = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (menuPosition && !(event.target as HTMLElement).closest(".pin-menu")) {
      setMenuPosition(null);
      return;
    }
    if (
      options.locked ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest("button, .pin-menu")
    )
      return;
    event.preventDefault();
    void getCurrentWindow().startDragging();
  };

  const updateOptions = async (next: PinOptions): Promise<void> => {
    const previous = options;
    try {
      const saved = await invoke<PinOptions>("update_pin_options", {
        id: pinId,
        opacity: next.opacity,
        locked: next.locked,
      });
      setOptions(saved);
    } catch (error) {
      setOptions(previous);
      setLoadError(`贴图设置失败：${String(error)}`);
    }
  };

  const runPinCommand = async (command: string): Promise<void> => {
    try {
      await invoke(command, { id: pinId });
      if (command !== "close_pin_window") setMenuPosition(null);
    } catch (error) {
      setLoadError(`贴图操作失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const flushScale = (): void => {
    scaleFrame.current = null;
    if (scaleDisposed.current || scaleInFlight.current || !pendingScale.current) return;

    const request = pendingScale.current;
    pendingScale.current = null;
    scaleInFlight.current = true;
    void invoke("scale_pin_window", {
      id: pinId,
      anchorX: request.anchorX,
      anchorY: request.anchorY,
      factor: request.factor,
    })
      .catch((error) => {
        if (!scaleDisposed.current)
          setLoadError(`贴图缩放失败：${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        scaleInFlight.current = false;
        if (!scaleDisposed.current && pendingScale.current && scaleFrame.current === null)
          scaleFrame.current = requestAnimationFrame(flushScale);
      });
  };

  const scaleAtPointer = (event: React.WheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const delta =
      event.deltaY *
      (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, bounds.height) : 1);
    const factor = Math.exp((-delta * Math.log(1.12)) / 100);
    const current = pendingScale.current;
    pendingScale.current = {
      factor: Math.min(4, Math.max(0.25, (current?.factor ?? 1) * factor)),
      anchorX: (event.clientX - bounds.left) / Math.max(1, bounds.width),
      anchorY: (event.clientY - bounds.top) / Math.max(1, bounds.height),
    };
    if (!scaleInFlight.current && scaleFrame.current === null)
      scaleFrame.current = requestAnimationFrame(flushScale);
  };

  return (
    <div
      className={`pin-wrap${loadError ? " pin-wrap-error" : ""}`}
      onPointerDown={startDragging}
      onWheel={scaleAtPointer}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuPosition({
          left: Math.min(event.clientX, Math.max(8, window.innerWidth - 190)),
          top: Math.min(event.clientY, Math.max(8, window.innerHeight - 220)),
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
            void invoke("pin_image_ready", { id: pinId }).catch((error) => {
              setLoadError(
                `贴图显示失败：${error instanceof Error ? error.message : String(error)}`,
              );
            });
          }}
          onError={() => setLoadError("贴图加载失败：无法解码 PNG 图片")}
        />
      ) : null}
      {loadError ? (
        <div className="pin-load-error" role="alert">
          {loadError}
        </div>
      ) : null}
      {menuPosition ? (
        <div
          className="pin-menu"
          style={menuPosition}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <label>
            <span>透明度 {Math.round(options.opacity * 100)}%</span>
            <input
              type="range"
              min="20"
              max="100"
              step="5"
              value={Math.round(options.opacity * 100)}
              onChange={(event) =>
                void updateOptions({ ...options, opacity: Number(event.target.value) / 100 })
              }
            />
          </label>
          <button
            type="button"
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
        aria-label="Close"
        title="Close"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => void runPinCommand("close_pin_window")}
      >
        ×
      </button>
    </div>
  );
}
