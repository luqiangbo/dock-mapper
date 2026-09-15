import { Divider, Dropdown, type MenuProps } from "antd";
import {
  ArrowUpRight,
  Check,
  Circle,
  MoreHorizontal,
  PenLine,
  Pin,
  QrCode,
  Save,
  ScanText,
  Square,
  Diamond,
  Eraser,
  Minus,
  MousePointer2,
  Type,
  Undo2,
  Redo2,
  X,
} from "lucide-react";
import { forwardRef } from "react";
import { useI18n } from "../i18n";
import TooltipButton from "./TooltipButton";
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
  shapeKind: FrameShape;
  canUndo: boolean;
  canRedo: boolean;
  compact: boolean;
  toolsDisabled?: boolean;
  actionsDisabled?: boolean;
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
  function AnnotationToolbar(
    {
      tool,
      shapeKind,
      canUndo,
      canRedo,
      compact,
      toolsDisabled,
      actionsDisabled,
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
    },
    ref,
  ): React.JSX.Element {
    const { t } = useI18n();
    const locked = Boolean(toolsDisabled);
    const actionsLocked = Boolean(actionsDisabled);
    const iconProps = { size: 19, strokeWidth: 2.45, "aria-hidden": true };
    const overflowActions = { ocr: onOcr, qr: onQr, save: onSave, pin: onPin } as const;
    const overflowItems: MenuProps["items"] = [
      {
        key: "ocr",
        icon: <ScanText size={16} />,
        label: ocrRunning ? "正在识别文字" : "识别文字",
        disabled: actionsLocked || ocrDisabled || ocrRunning,
      },
      {
        key: "qr",
        icon: <QrCode size={16} />,
        label: "识别二维码",
        disabled: actionsLocked || ocrDisabled,
      },
      { type: "divider" },
      {
        key: "save",
        icon: <Save size={16} />,
        label: t.toolbar.save,
        disabled: actionsLocked || confirmDisabled,
      },
      {
        key: "pin",
        icon: <Pin size={16} />,
        label: t.toolbar.pin,
        disabled: actionsLocked || confirmDisabled,
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
          <div className="wx-toolbar__group">
            <TooltipButton
              label="选择（V）"
              active={tool === "select"}
              disabled={locked}
              onClick={() => onToolChange("select")}
            >
              <MousePointer2 {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label="矩形"
              active={tool === "rect"}
              disabled={locked}
              onClick={() => onToolChange("rect")}
            >
              <Square {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label="圆形"
              active={tool === "ellipse"}
              disabled={locked}
              onClick={() => onToolChange("ellipse")}
            >
              <Circle {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label="菱形"
              active={tool === "diamond"}
              disabled={locked}
              onClick={() => onToolChange("diamond")}
            >
              <Diamond {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label="线条"
              active={tool === "line"}
              disabled={locked}
              onClick={() => onToolChange("line")}
            >
              <Minus {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label={t.toolbar.arrow}
              active={tool === "arrow"}
              disabled={locked}
              onClick={() => onToolChange("arrow")}
            >
              <ArrowUpRight {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label={t.toolbar.pen}
              active={tool === "pen"}
              disabled={locked}
              onClick={() => onToolChange("pen")}
            >
              <PenLine {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label={t.toolbar.text}
              active={tool === "text"}
              disabled={locked}
              onClick={() => onToolChange("text")}
            >
              <Type {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label="对象橡皮擦"
              active={tool === "eraser"}
              disabled={locked}
              onClick={() => onToolChange("eraser")}
            >
              <Eraser {...iconProps} />
            </TooltipButton>
          </div>

          {!compact && (
            <>
              <Divider type="vertical" />
              <div className="wx-toolbar__group">
                <TooltipButton
                  label={ocrRunning ? "正在识别文字" : "识别文字（当前 OCR 引擎）"}
                  disabled={actionsLocked || ocrDisabled}
                  loading={ocrRunning}
                  onClick={onOcr}
                >
                  <ScanText {...iconProps} />
                </TooltipButton>
                <TooltipButton label="识别二维码" disabled={actionsLocked || ocrDisabled} onClick={onQr}>
                  <QrCode {...iconProps} />
                </TooltipButton>
              </div>
            </>
          )}

          <Divider type="vertical" />
          <div className="wx-toolbar__group">
            <TooltipButton label={t.toolbar.undo} disabled={locked || !canUndo} onClick={onUndo}>
              <Undo2 {...iconProps} />
            </TooltipButton>
            <TooltipButton label="重做" disabled={locked || !canRedo} onClick={() => onRedo?.()}>
              <Redo2 {...iconProps} />
            </TooltipButton>
            {compact ? (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: overflowItems,
                  onClick: ({ key }) => overflowActions[key as keyof typeof overflowActions](),
                }}
                onOpenChange={onPopupOpenChange}
              >
                <span>
                  <TooltipButton label="更多操作">
                    <MoreHorizontal {...iconProps} />
                  </TooltipButton>
                </span>
              </Dropdown>
            ) : (
              <>
                <TooltipButton
                  label={t.toolbar.save}
                  disabled={actionsLocked || confirmDisabled}
                  onClick={onSave}
                >
                  <Save {...iconProps} />
                </TooltipButton>
                <TooltipButton
                  label={t.toolbar.pin}
                  disabled={actionsLocked || confirmDisabled}
                  onClick={onPin}
                >
                  <Pin {...iconProps} />
                </TooltipButton>
              </>
            )}
          </div>

          <Divider type="vertical" />
          <div className="wx-toolbar__group">
            <TooltipButton label={t.toolbar.cancel} danger onClick={onCancel}>
              <X {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label={t.toolbar.done}
              success
              disabled={actionsLocked || confirmDisabled}
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
