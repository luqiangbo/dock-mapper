import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalSize } from "@tauri-apps/api/window";
import { copyBinaryPayload } from "../utils/binaryPayload";

interface PinOptions {
  opacity: number;
  locked: boolean;
}

export default function PinImage(): React.JSX.Element {
  const pinId = new URLSearchParams(window.location.search).get("id") ?? getCurrentWindow().label;
  const [imageUrl, setImageUrl] = useState("");
  const [loadError, setLoadError] = useState("");
  const [options, setOptions] = useState<PinOptions>({ opacity: 1, locked: false });
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const imageUrlRef = useRef("");
  const aspectRatio = useRef(1);
  const correctingSize = useRef(false);
  const userResizing = useRef(false);
  const resizeIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    void invoke<PinOptions>("get_pin_options", { id: pinId }).then(setOptions).catch(() => undefined);
  }, [pinId]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void appWindow
      .onResized(({ payload: size }) => {
        // Native code also resizes this prewarmed window whenever a new image
        // is pinned. Only project sizes back to the image ratio while the user
        // is actively dragging the resize handle; otherwise the previous
        // image's ratio can overwrite the new screenshot's exact dimensions.
        if (disposed || !userResizing.current || correctingSize.current || aspectRatio.current <= 0)
          return;

        if (resizeIdleTimer.current) clearTimeout(resizeIdleTimer.current);
        resizeIdleTimer.current = setTimeout(() => {
          userResizing.current = false;
          resizeIdleTimer.current = null;
        }, 180);

        // Project the freely-resized native window back onto the image's
        // aspect ratio. This remains smooth for corner and edge resizing and
        // prevents object-fit letterboxing from making the image and window
        // sizes disagree.
        const ratio = aspectRatio.current;
        const projectedHeight = (ratio * size.width + size.height) / (ratio * ratio + 1);
        const nextHeight = Math.max(projectedHeight, 60, 60 / ratio);
        const nextWidth = ratio * nextHeight;

        if (Math.abs(nextWidth - size.width) <= 1 && Math.abs(nextHeight - size.height) <= 1)
          return;
        correctingSize.current = true;
        const corrected = new PhysicalSize(Math.round(nextWidth), Math.round(nextHeight));
        void appWindow.setSize(corrected).finally(() => {
          correctingSize.current = false;
        });
      })
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      });

    return () => {
      disposed = true;
      unlisten?.();
      if (resizeIdleTimer.current) clearTimeout(resizeIdleTimer.current);
      resizeIdleTimer.current = null;
      userResizing.current = false;
    };
  }, []);

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
    setOptions(next);
    try {
      const saved = await invoke<PinOptions>("update_pin_options", {
        id: pinId,
        opacity: next.opacity,
        locked: next.locked,
      });
      setOptions(saved);
    } catch (error) {
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

  const scaleAtPointer = (event: React.WheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    void invoke("scale_pin_window", {
      id: pinId,
      anchorX: (event.clientX - bounds.left) / Math.max(1, bounds.width),
      anchorY: (event.clientY - bounds.top) / Math.max(1, bounds.height),
      factor,
    });
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
          onLoad={(event) => {
            const image = event.currentTarget;
            aspectRatio.current = image.naturalWidth / Math.max(1, image.naturalHeight);
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
          <button type="button" onClick={() => void updateOptions({ ...options, locked: !options.locked })}>
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
      {!options.locked && <button
        type="button"
        className="pin-resize"
        aria-label="Resize"
        title="Resize"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          userResizing.current = true;
          if (resizeIdleTimer.current) clearTimeout(resizeIdleTimer.current);
          void getCurrentWindow()
            .startResizeDragging("SouthEast")
            .catch(() => {
              userResizing.current = false;
            });
        }}
      />}
    </div>
  );
}
