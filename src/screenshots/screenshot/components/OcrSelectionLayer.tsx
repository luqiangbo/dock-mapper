import type { OcrResult } from "../../../api/screenshotTypes";
import { useEffect, useLayoutEffect, useRef } from "react";
import { PinOcrText } from "../hooks/usePinOcr";
import { TRANSLATION_FONT, type TranslationTextLayout } from "./translationAppearance";

function ocrBlockSuffix(
  current: OcrResult["blocks"][number],
  next: OcrResult["blocks"][number] | undefined,
): string {
  if (!next) return "";
  const currentCenterY = current.y + current.height / 2;
  const nextCenterY = next.y + next.height / 2;
  const tolerance = Math.max(current.height, next.height) * 0.55;
  if (Math.abs(nextCenterY - currentCenterY) <= tolerance && next.x >= current.x) {
    return " ";
  }
  return "\n";
}

function TranslatedSelectionText({
  layout,
  width,
  height,
  suffix,
}: {
  layout: TranslationTextLayout;
  width: number;
  height: number;
  suffix: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const span = ref.current;
    if (!span) return;
    const fit = () => {
      const scale = span.getBoundingClientRect().width / layout.width;
      span.style.fontSize = `${layout.fontSize * scale}px`;
      span.style.lineHeight = `${layout.lineHeight * scale}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(span);
    return () => observer.disconnect();
  }, [layout]);
  return (
    <span
      ref={ref}
      data-pin-ocr
      style={{
        position: "absolute",
        left: `${(layout.x / width) * 100}%`,
        top: `${((layout.y + layout.selectionOffsetY) / height) * 100}%`,
        width: `${(layout.width / width) * 100}%`,
        height: `${(layout.height / height) * 100}%`,
        fontFamily: TRANSLATION_FONT,
        fontWeight: layout.fontWeight ?? 400,
        whiteSpace: "pre",
        color: "transparent",
        cursor: "text",
        userSelect: "text",
      }}
    >
      {layout.lines.join("\n")}
      {suffix}
    </span>
  );
}

export function selectedOcrText(): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return "";
  const element = (node: Node | null) => (node instanceof Element ? node : node?.parentElement);
  const start = element(selection.anchorNode)?.closest("[data-ocr-selection]");
  const end = element(selection.focusNode)?.closest("[data-ocr-selection]");
  return start && start === end ? selection.toString() : "";
}

export function OcrSelectionLayer({
  result,
  width,
  height,
  layouts,
}: {
  result: OcrResult;
  width: number;
  height: number;
  layouts?: TranslationTextLayout[];
}) {
  useEffect(
    () => () => {
      if (selectedOcrText()) window.getSelection()?.removeAllRanges();
    },
    [result],
  );
  return (
    <div
      data-ocr-selection
      className="ocr-selection-layer"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {layouts
        ? layouts.map((layout, index) => (
            <TranslatedSelectionText
              key={index}
              layout={layout}
              width={width}
              height={height}
              suffix={
                index < layouts.length - 1
                  ? ocrBlockSuffix(
                      result.blocks[index] ?? { ...layout, text: "", confidence: 1 },
                      result.blocks[index + 1],
                    )
                  : ""
              }
            />
          ))
        : result.blocks.map((block, index) => (
            <PinOcrText
              key={index}
              block={block}
              width={width}
              height={height}
              suffix={ocrBlockSuffix(block, result.blocks[index + 1])}
            />
          ))}
    </div>
  );
}
