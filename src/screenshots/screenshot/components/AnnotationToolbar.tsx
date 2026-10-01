import { Divider, Dropdown, type MenuProps } from "antd";
import { Check, MoreHorizontal, Pin, QrCode, Save, ScanText, Undo2, Redo2, X } from "lucide-react";
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
  ocrDisabled?: boolean;
  ocrRunning?: boolean;
  onToolChange: (tool: AnnotTool) => void;
  onUndo: () => void;
  onRedo?: () => void;
  onSave: () => void;
  onPin: () => void;
  onOcr: () => void;
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
      ocrDisabled,
      ocrRunning,
      onToolChange,
      onUndo,
      onRedo,
      onSave,
      onPin,
      onOcr,
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
    const labels = { ...SCREENSHOT_TOOL_LABELS, select: "选择（V）", eraser: "对象橡皮擦" };
    const { main, more } = screenshotToolbarGroups(toolbarTools);
    const selectedMore = more.find((item) => item === tool);
    const MoreIcon = selectedMore ? icons[selectedMore] : MoreHorizontal;
    const iconProps = { size: 18, strokeWidth: 1.8, "aria-hidden": true };
    const items: MenuProps["items"] = [
      ...more.map((key) => {
        const Icon = icons[key];
        return { key, label: labels[key], icon: <Icon size={16} />, disabled: toolsDisabled };
      }),
      ...(more.length ? [{ type: "divider" as const }] : []),
      {
        key: "ocr",
        label: ocrRunning ? "正在识别文字…" : "识别文字",
        icon: <ScanText size={16} />,
        disabled: actionsDisabled || ocrDisabled || ocrRunning,
      },
      {
        key: "qr",
        label: "识别二维码",
        icon: <QrCode size={16} />,
        disabled: actionsDisabled || ocrDisabled,
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
                    label={labels[key]}
                    active={tool === key}
                    disabled={toolsDisabled}
                    onClick={() => onToolChange(key)}
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
                  selectedKeys: tool ? [tool] : [],
                  onClick: ({ key }) => {
                    changeOpen(false);
                    if (key === "ocr") onOcr();
                    else if (key === "qr") onQr();
                    else onToolChange(key as AnnotTool);
                  },
                }}
              >
                <span>
                  <TooltipButton
                    label={
                      selectedMore
                        ? labels[selectedMore]
                        : ocrRunning
                          ? "更多工具 · 正在识别文字"
                          : "更多工具"
                    }
                    active={!!selectedMore || moreOpen}
                  >
                    <MoreIcon {...iconProps} />
                  </TooltipButton>
                </span>
              </Dropdown>
            </div>
            <Divider type="vertical" />
            <div className="wx-toolbar__group">
              <TooltipButton
                label="撤销（Ctrl+Z）"
                disabled={toolsDisabled || !canUndo}
                onClick={onUndo}
              >
                <Undo2 {...iconProps} />
              </TooltipButton>
              <TooltipButton
                label="重做（Ctrl+Shift+Z）"
                disabled={toolsDisabled || !canRedo}
                onClick={onRedo}
              >
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
            <TooltipButton
              label="复制图片（Enter）"
              loading={busy}
              success
              disabled={actionsDisabled || confirmDisabled}
              onClick={onConfirm}
            >
              <Check {...iconProps} />
            </TooltipButton>
            <TooltipButton label="取消（Esc）" danger onClick={onCancel}>
              <X {...iconProps} />
            </TooltipButton>
          </div>
        </div>
      </div>
    );
  },
);
export default AnnotationToolbar;
