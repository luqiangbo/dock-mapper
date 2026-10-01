import { useEffect, useRef, useState } from "react";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import type { BinaryFileData, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { MosaicBounds } from "./mosaicPatch";
import { MosaicRenderer } from "./mosaicRenderer";
import { MosaicDrag } from "./mosaicDrag";
import type { MosaicEffect } from "../../../types";

interface Props {
  api: ExcalidrawImperativeAPI;
  baseCanvas: HTMLCanvasElement;
  blockSize: number;
  effect: MosaicEffect;
  blurRadius: number;
  captureKey: string;
  onError?: (message: string) => void;
}

/** Native image elements keep mosaic patches in the editor's history/export. */
export function MosaicDrawingLayer({
  api,
  baseCanvas,
  blockSize,
  effect,
  blurRadius,
  captureKey,
  onError,
}: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const gesture = useRef(new MosaicDrag());
  const renderer = useRef<MosaicRenderer | null>(null);
  if (!renderer.current) renderer.current = new MosaicRenderer();
  const frame = useRef<number | null>(null);
  const [drawing, setDrawing] = useState(false);

  const cancel = () => {
    gesture.current.cancel();
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setDrawing(false);
  };
  useEffect(() => {
    const abort = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", abort, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", abort, true);
      window.removeEventListener("blur", cancel);
      gesture.current.cancel();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      renderer.current?.release();
    };
  }, []);
  useEffect(() => {
    cancel();
  }, [baseCanvas, blockSize, effect, blurRadius, captureKey]);

  const sessionKey = () => {
    const state = api.getAppState();
    const rect = layerRef.current?.getBoundingClientRect();
    return [
      captureKey,
      baseCanvas.width,
      baseCanvas.height,
      state.zoom.value,
      state.scrollX,
      state.scrollY,
      state.offsetLeft,
      state.offsetTop,
      rect?.left,
      rect?.top,
      rect?.width,
      rect?.height,
      effect,
      blockSize,
      blurRadius,
    ].join(":");
  };
  const render = (rect: MosaicBounds) =>
    renderer.current!.render(
      baseCanvas,
      rect,
      effect,
      effect === "blur" ? blurRadius : blockSize,
      api.getAppState().zoom.value,
    );
  const paint = (rect: MosaicBounds) => {
    const canvas = previewRef.current;
    const layer = layerRef.current;
    if (!canvas || !layer) return;
    if (!rect.width || !rect.height) {
      canvas.width = 0;
      return;
    }
    const state = api.getAppState();
    const patch = render(rect);
    const position = sceneCoordsToViewportCoords({ sceneX: rect.x, sceneY: rect.y }, state);
    const origin = layer.getBoundingClientRect();
    canvas.width = patch.width;
    canvas.height = patch.height;
    canvas.style.left = `${position.x - origin.left}px`;
    canvas.style.top = `${position.y - origin.top}px`;
    canvas.style.width = `${rect.width * state.zoom.value}px`;
    canvas.style.height = `${rect.height * state.zoom.value}px`;
    const output = canvas.getContext("2d");
    if (!output) throw new Error("马赛克预览画布不可用");
    output.drawImage(patch, 0, 0);
  };

  return (
    <div
      ref={layerRef}
      className="screenshot-mosaic-layer"
      aria-label="拖动绘制马赛克"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const start = viewportCoordsToSceneCoords(event, api.getAppState());
        if (!gesture.current.begin(event.pointerId, start, sessionKey())) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        if (previewRef.current) previewRef.current.width = 0;
        setDrawing(true);
      }}
      onPointerMove={(event) => {
        if (!gesture.current.owns(event.pointerId)) return;
        const point = viewportCoordsToSceneCoords(event, api.getAppState());
        if (!gesture.current.move(event.pointerId, point, sessionKey())) {
          setDrawing(false);
          return;
        }
        event.stopPropagation();
        if (frame.current !== null) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          const rect = gesture.current.bounds(baseCanvas.width, baseCanvas.height, sessionKey());
          if (!rect) {
            setDrawing(false);
            return;
          }
          try {
            paint(rect);
          } catch (cause) {
            cancel();
            onError?.(`马赛克绘制失败：${cause instanceof Error ? cause.message : String(cause)}`);
          }
        });
      }}
      onPointerUp={(event) => {
        if (!gesture.current.owns(event.pointerId)) return;
        event.stopPropagation();
        const rect = gesture.current.finish(
          event.pointerId,
          viewportCoordsToSceneCoords(event, api.getAppState()),
          sessionKey(),
          baseCanvas.width,
          baseCanvas.height,
        );
        cancel();
        if (!rect) return;
        try {
          const patch = render(rect);
          const id = crypto.randomUUID();
          const [element] = convertToExcalidrawElements([
            {
              type: "image",
              ...rect,
              fileId: id,
              status: "saved",
              scale: [1, 1],
              opacity: 100,
            } as never,
          ]);
          api.addFiles([
            {
              id,
              dataURL: patch.toDataURL("image/png"),
              mimeType: "image/png",
              created: Date.now(),
            } as BinaryFileData,
          ]);
          api.updateScene({
            elements: [...api.getSceneElements(), element],
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          });
        } catch (cause) {
          onError?.(`马赛克绘制失败：${cause instanceof Error ? cause.message : String(cause)}`);
        }
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
    >
      <canvas
        ref={previewRef}
        style={{
          display: drawing ? "block" : "none",
          imageRendering: effect === "blur" ? "auto" : "pixelated",
        }}
      />
    </div>
  );
}
