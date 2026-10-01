import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Button, Checkbox, Tooltip } from "antd";
import { HolderOutlined } from "@ant-design/icons";
import { MoreHorizontal } from "lucide-react";
import {
  defaultScreenshotTools,
  moveScreenshotTool,
  normalizeScreenshotTools,
  SCREENSHOT_TOOL_LABELS,
  type ScreenshotToolId,
  type ScreenshotToolbarTool,
} from "../utils/screenshotTools";
import { screenshotToolIcons } from "../utils/screenshotToolIcons";
import styles from "./components.module.scss";

export default function ScreenshotToolbarSettings({
  value,
  onChange,
}: {
  value?: ScreenshotToolbarTool[];
  onChange?: (next: ScreenshotToolbarTool[]) => void;
}) {
  const tools = useMemo(() => normalizeScreenshotTools(value), [value]);
  const host = useRef<HTMLDivElement>(null);
  const active = useRef<{
    id: ScreenshotToolId;
    pointerId: number;
    x: number;
    y: number;
    target: number;
    moved: boolean;
  } | null>(null);
  const [drag, setDrag] = useState<{ id: ScreenshotToolId; target: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const cancel = () => {
    active.current = null;
    setDrag(null);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
    };
  }, []);
  const move = (id: ScreenshotToolId, target: number) => {
    const next = moveScreenshotTool(tools, id, target);
    if (next === tools) return;
    onChange?.([...next]);
    setAnnouncement(`${SCREENSHOT_TOOL_LABELS[id]}已移至第 ${target + 1} 位，等待保存`);
  };
  const start = (event: PointerEvent<HTMLElement>, id: ScreenshotToolId, index: number) => {
    if (event.button !== 0 || active.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    active.current = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      target: index,
      moved: false,
    };
  };
  return (
    <section className={styles.screenshotToolsSection}>
      <div className={styles.screenshotToolsHeading}>
        <div>
          <strong>常用工具</strong>
          <span className={styles.description}>
            勾选后常驻工具栏，拖动手柄排序；未勾选的工具放入“更多”。
          </span>
        </div>
        <Button
          size="small"
          onClick={() => {
            cancel();
            onChange?.(defaultScreenshotTools());
          }}
        >
          恢复默认
        </Button>
      </div>
      <div ref={host} className={styles.screenshotToolsGrid}>
        {tools.map((tool, index) => {
          const Icon = screenshotToolIcons[tool.id];
          return (
            <div
              key={tool.id}
              data-tool-chip
              className={`${styles.screenshotToolChip} ${drag?.id === tool.id ? styles.metricDragging : ""} ${drag?.target === index && drag.id !== tool.id ? styles.screenshotToolDrop : ""}`}
            >
              <Button
                type="text"
                size="small"
                icon={<HolderOutlined />}
                className={styles.metricDragHandle}
                aria-label={`拖动${SCREENSHOT_TOOL_LABELS[tool.id]}排序`}
                title="拖动排序；Alt+左右方向键移动"
                onPointerDown={(event) => start(event, tool.id, index)}
                onPointerMove={(event) => {
                  const current = active.current;
                  if (!current || current.pointerId !== event.pointerId || !host.current) return;
                  if (
                    !current.moved &&
                    Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5
                  )
                    return;
                  current.moved = true;
                  let distance = Infinity;
                  [...host.current.querySelectorAll<HTMLElement>("[data-tool-chip]")].forEach(
                    (chip, target) => {
                      const rect = chip.getBoundingClientRect();
                      const next = Math.hypot(
                        event.clientX - rect.left - rect.width / 2,
                        event.clientY - rect.top - rect.height / 2,
                      );
                      if (next < distance) {
                        distance = next;
                        current.target = target;
                      }
                    },
                  );
                  setDrag({ id: current.id, target: current.target });
                }}
                onPointerUp={(event) => {
                  const current = active.current;
                  if (!current || current.pointerId !== event.pointerId) return;
                  cancel();
                  if (current.moved) move(current.id, current.target);
                }}
                onPointerCancel={cancel}
                onLostPointerCapture={cancel}
                onKeyDown={(event) => {
                  if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
                    event.preventDefault();
                    cancel();
                    move(tool.id, index + (event.key === "ArrowLeft" ? -1 : 1));
                  }
                }}
              />
              <Checkbox
                checked={tool.visible}
                onChange={(event) => {
                  cancel();
                  onChange?.(
                    tools.map((item) =>
                      item.id === tool.id ? { ...item, visible: event.target.checked } : item,
                    ),
                  );
                }}
              >
                <span className={styles.screenshotToolLabel}>
                  <Icon size={15} />
                  <span>{SCREENSHOT_TOOL_LABELS[tool.id]}</span>
                </span>
              </Checkbox>
            </div>
          );
        })}
      </div>
      <div className={styles.screenshotToolbarPreview} aria-label="常用工具顺序预览">
        <span>工具栏</span>
        {tools
          .filter((tool) => tool.visible)
          .map((tool) => {
            const Icon = screenshotToolIcons[tool.id];
            return (
              <Tooltip key={tool.id} title={SCREENSHOT_TOOL_LABELS[tool.id]}>
                <span aria-label={SCREENSHOT_TOOL_LABELS[tool.id]}>
                  <Icon size={17} />
                </span>
              </Tooltip>
            );
          })}
        <Tooltip title="更多工具">
          <span aria-label="更多工具">
            <MoreHorizontal size={17} />
          </span>
        </Tooltip>
      </div>
      <span className={styles.srOnly} role="status">
        {announcement}
      </span>
    </section>
  );
}
