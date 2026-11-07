import { Divider, Dropdown, type MenuProps } from "antd";
import { Check, MoreHorizontal, Pin, QrCode, Save, Undo2, Redo2, X } from "lucide-react";
import { forwardRef, useEffect, useState } from "react";
import TooltipButton from "./TooltipButton";
import { screenshotToolIcons } from "../../../utils/screenshotToolIcons";
import {
  SCREENSHOT_TOOL_LABELS,
  screenshotToolbarGroups,
  type ScreenshotToolbarTool,
} from "../../../utils/screenshotTools";
import type { FrameShape } from "./annotationTypes";
export type AnnotTool =
  | "select"
  | "rect"
  | "ellipse"
  | "diamond"
  | "line"
  | "arrow"
  | "pen"
  | "highlight"
  | "mosaic"
  | "picker"
  | "text"
  | "number"
  | "eraser"
  | null;

export const STROKE_COLORS = [
  "#e03131",
  "#f08c00",
  "#2f9e44",
  "#1971c2",
  "#7048e8",
  "#c2255c",
  "#1e1e1e",
  "#ffffff",
] as const;

interface AnnotationToolbarProps {
  tool: AnnotTool;
  toolbarTools?: ScreenshotToolbarTool[];
  shapeKind: FrameShape;
  canUndo: boolean;
  canRedo: boolean;
  compact: boolean;
  toolsDisabled?: boolean;
  actionsDisabled?: boolean;
  busy?: boolean;
  confirmDisabled?: boolean;
  qrDisabled?: boolean;
  onToolChange: (tool: AnnotTool) => void;
  onUndo: () => void;
  onRedo?: () => void;
  onSave: () => void;
  onPin: () => void;
  onTranslate: () => void;
  translationVisible?: boolean;
  translationRunning?: boolean;
  onQr: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onPopupOpenChange: (open: boolean) => void;
  style?: React.CSSProperties;
}

const AnnotationToolbar = forwardRef<HTMLDivElement, AnnotationToolbarProps>(
  function AnnotationToolbar(props, ref) {
    const {
      tool,
      toolbarTools,
      canUndo,
      canRedo,
      toolsDisabled,
      actionsDisabled,
      busy,
      confirmDisabled,
      qrDisabled,
      onToolChange,
      onUndo,
      onRedo,
      onSave,
      onPin,
      onTranslate,
      translationVisible,
      translationRunning,
      onQr,
      onCancel,
      onConfirm,
      onPopupOpenChange,
      style,
    } = props;
    const [moreOpen, setMoreOpen] = useState(false);
    const changeOpen = (open: boolean) => {
      setMoreOpen(open);
      onPopupOpenChange(open);
    };
    useEffect(() => {
      setMoreOpen(false);
      onPopupOpenChange(false);
    }, [tool, toolsDisabled, onPopupOpenChange]);
    const icons = screenshotToolIcons;
    const labels = { ...SCREENSHOT_TOOL_LABELS, eraser: "对象橡皮擦" };
    const { main, more } = screenshotToolbarGroups(toolbarTools);
    const selectedMore = more.find((item) => item === tool);
    const iconProps = { size: 20, strokeWidth: 1.8, "aria-hidden": true };
    const translationLabel = translationRunning
      ? "正在翻译…"
      : translationVisible
        ? "切回原文"
        : "显示译文";
    const items: MenuProps["items"] = [
      ...more.map((key) => {
        const Icon = icons[key];
        return {
          key,
          label: key === "translate" ? `翻译 · ${translationLabel}` : labels[key],
          icon: <Icon size={16} />,
          disabled: toolsDisabled || (key === "translate" && translationRunning),
        };
      }),
      ...(more.length ? [{ type: "divider" as const }] : []),
      {
        key: "qr",
        label: "识别二维码",
        icon: <QrCode size={16} />,
        disabled: actionsDisabled || qrDisabled,
      },
    ];
    return (
      <div
        ref={ref}
        className="wx-toolbar wx-toolbar--primary"
        style={style}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="wx-toolbar__row">
          <div className="wx-toolbar__tools">
            <div className="wx-toolbar__group">
              {main.map((key) => {
                const Icon = icons[key];
                return (
                  <TooltipButton
                    key={key}
                    label={key === "translate" ? `翻译 · ${translationLabel}` : labels[key]}
                    active={key === "translate" ? translationVisible : tool === key}
                    loading={key === "translate" && translationRunning}
                    disabled={toolsDisabled || (key === "translate" && translationRunning)}
                    onClick={() => (key === "translate" ? onTranslate() : onToolChange(key))}
                  >
                    <Icon {...iconProps} />
                  </TooltipButton>
                );
              })}

              <Dropdown
                open={moreOpen}
                trigger={["click"]}
                onOpenChange={changeOpen}
                menu={{
                  items,
                  selectable: true,
                  selectedKeys: [
                    ...(tool ? [tool] : []),
                    ...(translationVisible ? ["translate"] : []),
                  ],
                  onClick: ({ key }) => {
                    changeOpen(false);
                    if (key === "qr") onQr();
                    else if (key === "translate") onTranslate();
                    else {
                      onToolChange(key as AnnotTool);
                    }
                  },
                }}
              >
                <span>
                  <TooltipButton label="更多工具" active={!!selectedMore || moreOpen}>
                    <MoreHorizontal {...iconProps} />
                  </TooltipButton>
                </span>
              </Dropdown>
            </div>
            <Divider type="vertical" />
            <div className="wx-toolbar__group">
              <TooltipButton label="撤销" disabled={toolsDisabled || !canUndo} onClick={onUndo}>
                <Undo2 {...iconProps} />
              </TooltipButton>
              <TooltipButton label="重做" disabled={toolsDisabled || !canRedo} onClick={onRedo}>
                <Redo2 {...iconProps} />
              </TooltipButton>
            </div>
          </div>
          <Divider type="vertical" />
          <div className="wx-toolbar__group wx-toolbar__outputs">
            <TooltipButton
              label="保存图片"
              disabled={actionsDisabled || confirmDisabled}
              onClick={onSave}
            >
              <Save {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label="贴图"
              disabled={actionsDisabled || confirmDisabled}
              onClick={onPin}
            >
              <Pin {...iconProps} />
            </TooltipButton>
            <TooltipButton label="取消" danger onClick={onCancel}>
              <X {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label="完成并复制图片"
              loading={busy}
              success
              disabled={actionsDisabled || confirmDisabled}
              onClick={onConfirm}
            >
              <Check {...iconProps} />
            </TooltipButton>
          </div>
        </div>
      </div>
    );
  },
);
export default AnnotationToolbar;
