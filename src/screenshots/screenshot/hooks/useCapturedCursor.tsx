import { useEffect, useRef, useState } from "react";
import type { FullScreenshot } from "../../../api/screenshotTypes";
import type { Selection } from "./useCaptureLifecycle";
import type { SelectionCrop } from "../components/selectionGeometry";

export function useCapturedCursor(options: {
  cursor: FullScreenshot["cursor"];
  generation: number;
  enabled: boolean;
  blocked: boolean;
  imageWidth: number;
  imageHeight: number;
  selection: Selection | null;
  onError: (message: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const image = useRef<HTMLImageElement | null>(null);
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    let disposed = false;
    setVisible(false);
    image.current = null;
    if (options.cursor) {
      const value = new Image();
      value.crossOrigin = "anonymous";
      value.src = options.cursor.url;
      void value
        .decode()
        .then(() => {
          if (!disposed) image.current = value;
        })
        .catch((error) => {
          if (!disposed) latest.current.onError(`鼠标图像读取失败：${String(error)}`);
        });
    }
    return () => {
      disposed = true;
      image.current = null;
    };
  }, [options.generation, options.cursor?.url]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        !latest.current.enabled ||
        latest.current.blocked ||
        event.isComposing ||
        event.repeat ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        (event.key !== "`" && event.key !== "~") ||
        (event.target instanceof Element &&
          event.target.closest('input,textarea,[contenteditable="true"]'))
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!latest.current.cursor || !image.current) {
        latest.current.onError("本次截图没有可用的鼠标指针图像。");
        return;
      }
      setVisible((value) => !value);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  const composite = async (png: Uint8Array, crop: SelectionCrop | null) => {
    const cursor = options.cursor,
      pointer = image.current;
    if (!visible || !cursor || !pointer || !crop) return png;
    const url = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: "image/png" }));
    try {
      const base = new Image();
      base.src = url;
      await base.decode();
      const canvas = document.createElement("canvas");
      canvas.width = base.naturalWidth;
      canvas.height = base.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("鼠标合成画布不可用");
      ctx.drawImage(base, 0, 0);
      ctx.drawImage(
        pointer,
        ((cursor.x - crop.sourceX) * crop.outputWidth) / crop.sourceWidth,
        ((cursor.y - crop.sourceY) * crop.outputHeight) / crop.sourceHeight,
        (cursor.width * crop.outputWidth) / crop.sourceWidth,
        (cursor.height * crop.outputHeight) / crop.sourceHeight,
      );
      const result = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error("鼠标合成编码失败"))),
          "image/png",
        ),
      );
      return new Uint8Array(await result.arrayBuffer());
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  const rect = options.selection;
  const cursor = options.cursor;
  const sx = options.imageWidth / Math.max(1, window.innerWidth),
    sy = options.imageHeight / Math.max(1, window.innerHeight);
  return {
    composite,
    preview:
      visible && cursor && rect ? (
        <div
          style={{
            position: "absolute",
            pointerEvents: "none",
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            overflow: "hidden",
            zIndex: 20,
          }}
        >
          <img
            alt="捕获时的鼠标指针"
            src={cursor.url}
            style={{
              position: "absolute",
              left: cursor.x / sx - rect.x,
              top: cursor.y / sy - rect.y,
              width: cursor.width / sx,
              height: cursor.height / sy,
            }}
          />
        </div>
      ) : null,
  };
}
