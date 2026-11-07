import { Button, Spin } from "antd";
import { useEffect, useRef, useState } from "react";
import type { QrDecodeResult } from "../../../api/screenshotTypes";
import { qrResultPosition } from "./qrResultPosition";
import styles from "./QrResultOverlay.module.scss";

export interface QrResultOverlayProps {
  bounds: { x: number; y: number; width: number; height: number };
  result: QrDecodeResult;
  pending: boolean;
  error: string;
  onClose: () => void;
  onRetry: () => void;
  copy: (text: string) => Promise<boolean>;
}

/** Transient UI only; result bubbles never enter the exported screenshot. */
export function QrResultOverlay({
  bounds,
  result,
  pending,
  error,
  onClose,
  onRetry,
  copy,
}: QrResultOverlayProps) {
  const revision = useRef(0);
  const [action, setAction] = useState<{
    index: number;
    state: "pending" | "copied" | "failed";
  } | null>(null);
  useEffect(() => {
    revision.current++;
    setAction(null);
    return () => {
      revision.current++;
    };
  }, [result, pending]);
  const copyResult = async (index: number, content: string) => {
    const token = ++revision.current;
    setAction({ index, state: "pending" });
    try {
      if (!(await copy(content))) throw new Error("clipboard rejected text");
      if (token === revision.current) setAction({ index, state: "copied" });
    } catch {
      if (token === revision.current) setAction({ index, state: "failed" });
    }
  };
  const stateText = pending ? "正在识别二维码…" : error || "未发现二维码";
  return (
    <div
      className={styles.region}
      aria-label="选区内二维码识别结果"
      style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}
    >
      <div
        className={styles.surface}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            revision.current++;
            onClose();
          }
        }}
      >
        {pending || error || result.codes.length === 0 ? (
          <div
            className={styles.bubble}
            style={{
              left: "50%",
              top: "50%",
              width: Math.min(220, Math.max(1, bounds.width - 12)),
            }}
          >
            <span className={styles.caption} title={stateText} role="status">
              {pending && <Spin size="small" />}
              {stateText}
            </span>
            {!pending && (
              <Button size="small" onClick={onRetry}>
                重试
              </Button>
            )}
          </div>
        ) : (
          result.codes.map((code, index) => {
            const current = action?.index === index ? action.state : null;
            return (
              <div
                key={index}
                className={styles.bubble}
                style={qrResultPosition(code, result, bounds)}
              >
                <span className={styles.caption} title={code.content}>
                  {code.content}
                </span>
                <Button
                  size="small"
                  loading={current === "pending"}
                  disabled={action?.state === "pending"}
                  aria-label={`复制二维码 ${index + 1}`}
                  onClick={() => void copyResult(index, code.content)}
                >
                  {current === "copied"
                    ? "已复制"
                    : current === "failed"
                      ? "复制失败，重试"
                      : "复制"}
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
