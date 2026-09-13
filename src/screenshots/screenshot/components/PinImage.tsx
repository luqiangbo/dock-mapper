import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { copyBinaryPayload } from "../utils/binaryPayload";
import { invokeCommand, type PinActionCommand } from "../../../api/ipc";
import type { PinOptions } from "../../../api/screenshotTypes";
import { usePinZoomController } from "../hooks/usePinZoomController";

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
  const { onWheel: scaleAtPointer, zoomError } = usePinZoomController(pinId, !options.locked);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const refreshImage = async (): Promise<void> => {
      try {
        // `tauri::ipc::Response` is delivered to JavaScript as an ArrayBuffer.
        // Normalize it instead of relying on the invoke generic, which only
        // affects TypeScript and does not convert the runtime value.
        const png = await invokeCommand("get_pin_image", { id: pinId });
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
        const value = await invokeCommand("get_pin_options", { id: pinId });
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
      const saved = await invokeCommand("update_pin_options", {
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
      className={`pin-wrap${loadError || zoomError ? " pin-wrap-error" : ""}`}
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
            void invokeCommand("pin_image_ready", { id: pinId }).catch((error) => {
              setLoadError(
                `贴图显示失败：${error instanceof Error ? error.message : String(error)}`,
              );
            });
          }}
          onError={() => setLoadError("贴图加载失败：无法解码 PNG 图片")}
        />
      ) : null}
      {loadError || zoomError ? (
        <div className="pin-load-error" role="alert">
          {loadError || zoomError}
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
