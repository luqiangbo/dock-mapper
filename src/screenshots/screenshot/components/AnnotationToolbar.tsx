import { Divider, Dropdown, type MenuProps } from "antd";
import {
  ArrowUpRight,
  Check,
  Grid3X3,
  Highlighter,
  ListOrdered,
  MoreHorizontal,
  PenLine,
  Pin,
  Pipette,
  QrCode,
  Save,
  ScanText,
  Square,
  Diamond,
  Eraser,
  Lock,
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
  confirmDisabled?: boolean;
  ocrDisabled?: boolean;
  ocrRunning?: boolean;
  continuousDraw?: boolean;
  selectionCount?: number;
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
  onContinuousDrawChange?: (locked: boolean) => void;
  onDuplicateSelection?: () => void;
  onGroupSelection?: () => void;
  onUngroupSelection?: () => void;
  onLayerMove?: (move: "front" | "forward" | "backward" | "back") => void;
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
      confirmDisabled,
      ocrDisabled,
      ocrRunning,
      continuousDraw,
      selectionCount = 0,
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
      onContinuousDrawChange,
      onDuplicateSelection,
      onGroupSelection,
      onUngroupSelection,
      onLayerMove,
      style,
    },
    ref,
  ): React.JSX.Element {
    const { t } = useI18n();
    const locked = Boolean(toolsDisabled);
    const toggle = (next: Exclude<AnnotTool, null>) => onToolChange(tool === next ? "select" : next);
    const frameActive = tool === "rect" || tool === "ellipse" || tool === "diamond";
    const iconProps = { size: 19, strokeWidth: 2.45, "aria-hidden": true };
    const overflowActions = { ocr: onOcr, qr: onQr, save: onSave, pin: onPin } as const;
    const overflowItems: MenuProps["items"] = [
      {
        key: "ocr",
        icon: <ScanText size={16} />,
        label: ocrRunning ? "正在识别文字" : "识别文字",
        disabled: locked || ocrDisabled || ocrRunning,
      },
      {
        key: "qr",
        icon: <QrCode size={16} />,
        label: "识别二维码",
        disabled: locked || ocrDisabled,
      },
      { type: "divider" },
      {
        key: "save",
        icon: <Save size={16} />,
        label: t.toolbar.save,
        disabled: locked || confirmDisabled,
      },
      {
        key: "pin",
        icon: <Pin size={16} />,
        label: t.toolbar.pin,
        disabled: locked || confirmDisabled,
      },
    ];
    const selectionItems: MenuProps["items"] = [
      { key: "duplicate", label: "复制对象（Ctrl+D）" },
      { key: "group", label: "分组（Ctrl+G）", disabled: selectionCount < 2 },
      { key: "ungroup", label: "取消分组（Ctrl+Shift+G）" },
      { type: "divider" },
      { key: "front", label: "置顶（Ctrl+Shift+]）" },
      { key: "forward", label: "上移一层（Ctrl+]）" },
      { key: "backward", label: "下移一层（Ctrl+[）" },
      { key: "back", label: "置底（Ctrl+Shift+[）" },
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
              label="框选标注"
              active={frameActive}
              disabled={locked}
              onClick={() => onToolChange(frameActive ? "select" : shapeKind)}
            >
              <Square {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label="菱形"
              active={tool === "diamond"}
              disabled={locked}
              onClick={() => toggle("diamond")}
            >
              <Diamond {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label="线条"
              active={tool === "line"}
              disabled={locked}
              onClick={() => toggle("line")}
            >
              <Minus {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label={t.toolbar.arrow}
              active={tool === "arrow"}
              disabled={locked}
              onClick={() => toggle("arrow")}
            >
              <ArrowUpRight {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label={t.toolbar.pen}
              active={tool === "pen"}
              disabled={locked}
              onClick={() => toggle("pen")}
            >
              <PenLine {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label={t.toolbar.highlight}
              active={tool === "highlight"}
              disabled={locked}
              onClick={() => toggle("highlight")}
            >
              <Highlighter {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label={t.toolbar.mosaic}
              active={tool === "mosaic"}
              disabled={locked}
              onClick={() => toggle("mosaic")}
            >
              <Grid3X3 {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label={t.toolbar.text}
              active={tool === "text"}
              disabled={locked}
              onClick={() => toggle("text")}
            >
              <Type {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label={t.toolbar.picker}
              active={tool === "picker"}
              disabled={locked}
              onClick={() => toggle("picker")}
            >
              <Pipette {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label="顺序标号"
              active={tool === "number"}
              disabled={locked}
              onClick={() => toggle("number")}
            >
              <ListOrdered {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label="对象橡皮擦"
              active={tool === "eraser"}
              disabled={locked}
              onClick={() => toggle("eraser")}
            >
              <Eraser {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label={continuousDraw ? "关闭连续绘制" : "连续绘制"}
              active={continuousDraw}
              disabled={locked}
              onClick={() => onContinuousDrawChange?.(!continuousDraw)}
            >
              <Lock {...iconProps} />
            </TooltipButton>
          </div>

          {!compact && (
            <>
              <Divider type="vertical" />
              <div className="wx-toolbar__group">
                <TooltipButton
                  label={ocrRunning ? "正在识别文字" : "识别文字（当前 OCR 引擎）"}
                  disabled={locked || ocrDisabled}
                  loading={ocrRunning}
                  onClick={onOcr}
                >
                  <ScanText {...iconProps} />
                </TooltipButton>
                <TooltipButton label="识别二维码" disabled={locked || ocrDisabled} onClick={onQr}>
                  <QrCode {...iconProps} />
                </TooltipButton>
              </div>
            </>
          )}

          <Divider type="vertical" />
          <div className="wx-toolbar__group">
            {selectionCount > 0 && (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: selectionItems,
                  onClick: ({ key }) => {
                    if (key === "duplicate") onDuplicateSelection?.();
                    else if (key === "group") onGroupSelection?.();
                    else if (key === "ungroup") onUngroupSelection?.();
                    else onLayerMove?.(key as "front" | "forward" | "backward" | "back");
                  },
                }}
                onOpenChange={onPopupOpenChange}
              >
                <span><TooltipButton label="对象操作"><MoreHorizontal {...iconProps} /></TooltipButton></span>
              </Dropdown>
            )}
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
                  disabled={locked || confirmDisabled}
                  onClick={onSave}
                >
                  <Save {...iconProps} />
                </TooltipButton>
                <TooltipButton
                  label={t.toolbar.pin}
                  disabled={locked || confirmDisabled}
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
              disabled={confirmDisabled}
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
