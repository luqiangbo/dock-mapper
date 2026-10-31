import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Spin } from "antd";
import { invokeCommand } from "../../../api/ipc";
import type { OcrResult } from "../../../api/screenshotTypes";

function PinOcrText({
  block,
  width,
  height,
}: {
  block: OcrResult["blocks"][number];
  width: number;
  height: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const span = ref.current;
    if (!span) return;
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return;
    const fit = () => {
      const lines = block.text.split("\n");
      const lineHeight = span.clientHeight / Math.max(1, lines.length);
      context.font = "100px Arial";
      const measured = Math.max(1, ...lines.map((line) => context.measureText(line).width));
      const fontSize = Math.max(
        0.1,
        Math.min(lineHeight * 0.9, (span.clientWidth * 100) / measured),
      );
      span.style.fontSize = fontSize + "px";
      span.style.lineHeight = lineHeight + "px";
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(span);
    return () => observer.disconnect();
  }, [block.text, width, height]);
  return (
    <span
      ref={ref}
      data-pin-ocr
      style={{
        position: "absolute",
        left: (block.x / width) * 100 + "%",
        top: (block.y / height) * 100 + "%",
        width: (block.width / width) * 100 + "%",
        height: (block.height / height) * 100 + "%",
        fontFamily: "Arial",
        color: "transparent",
        whiteSpace: "pre",
        overflow: "hidden",
        cursor: "text",
        userSelect: "text",
      }}
      onPointerDown={(event) => {
        if (!event.altKey) event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        if (!event.altKey) event.stopPropagation();
      }}
    >
      {block.text}
    </span>
  );
}

export function usePinOcr(pinId: string, imageUrl: string) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    pending: boolean;
    result: OcrResult | null;
    error: string;
    width: number;
    height: number;
  }>({ pending: false, result: null, error: "", width: 1, height: 1 });
  const [feedback, setFeedback] = useState("");
  const current = useRef(state);
  current.current = state;
  useEffect(() => {
    if (!imageUrl) return;
    let disposed = false;
    setFeedback("");
    setState({ pending: true, result: null, error: "", width: 1, height: 1 });
    void (async () => {
      const response = await fetch(imageUrl);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const image = new Image();
      image.src = imageUrl;
      await image.decode();
      if (disposed) return;
      const imageId = await invokeCommand("upload_image", bytes);
      if (disposed) {
        await invokeCommand("release_image", { imageId });
        return;
      }
      let result: OcrResult;
      try {
        result = await invokeCommand("recognize_selection", { imageId });
      } finally {
        await invokeCommand("release_image", { imageId }).catch((error) =>
          console.error("OCR 临时图片释放失败", error),
        );
      }
      if (!disposed)
        setState({
          pending: false,
          result,
          error: "",
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
    })().catch((error) => {
      if (!disposed)
        setState({ pending: false, result: null, error: String(error), width: 1, height: 1 });
    });
    return () => {
      disposed = true;
    };
  }, [pinId, imageUrl, attempt]);
  useEffect(() => {
    let disposed = false,
      timer = 0;
    const key = (event: KeyboardEvent) => {
      if (
        !event.shiftKey ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.key.toLowerCase() !== "c" ||
        event.isComposing
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest('input,textarea,[contenteditable="true"]')
      )
        return;
      event.preventDefault();
      const state = current.current;
      if (state.pending) {
        setFeedback("正在识别文字…");
        return;
      }
      const text = state.result?.text;
      if (!text?.trim()) {
        setFeedback(state.error ? "文字识别失败，请重试" : "未发现文字");
        return;
      }
      void invokeCommand("copy_text", { value: text })
        .then((copied) => {
          if (!copied) throw new Error("剪贴板未接受文字");
          if (!disposed && current.current === state) setFeedback("文字已复制");
        })
        .catch((error) => {
          if (!disposed && current.current === state) setFeedback(`复制失败：${String(error)}`);
        });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!disposed) setFeedback("");
      }, 1800);
    };
    window.addEventListener("keydown", key);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.removeEventListener("keydown", key);
    };
  }, [pinId]);
  return (
    <>
      {state.result?.blocks.map((block, index) => (
        <PinOcrText key={index} block={block} width={state.width} height={state.height} />
      ))}
      {(state.pending ||
        state.error ||
        feedback ||
        (state.result && !state.result.text.trim())) && (
        <div
          className="special-tool-feedback"
          style={{ pointerEvents: "auto" }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {state.pending ? (
            <>
              <Spin size="small" />
              正在识别文字…
            </>
          ) : (
            feedback || (state.error ? `文字识别失败：${state.error}` : "未发现文字")
          )}
          {state.error && (
            <Button size="small" onClick={() => setAttempt((n) => n + 1)}>
              重试识别
            </Button>
          )}
        </div>
      )}
    </>
  );
}
