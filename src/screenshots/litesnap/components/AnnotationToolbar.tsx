import { Divider, Dropdown, type MenuProps } from "antd";
import {
  ArrowUpRight,
  Check,
  Circle,
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
  Type,
  Undo2,
  Redo2,
  X,
} from "lucide-react";
import { forwardRef } from "react";
import { useI18n } from "../i18n";
import TooltipButton from "./TooltipButton";

export type AnnotTool =
  | "rect"
  | "ellipse"
  | "arrow"
  | "pen"
  | "highlight"
  | "mosaic"
  | "picker"
  | "text"
  | "number"
  | null;

export const STROKE_COLORS = [
  "#f43f5e",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#6366f1",
  "#ffffff",
  "#15161d",
] as const;

interface AnnotationToolbarProps {
  tool: AnnotTool;
  canUndo: boolean;
  canRedo: boolean;
  compact: boolean;
  toolsDisabled?: boolean;
  confirmDisabled?: boolean;
  ocrDisabled?: boolean;
  ocrRunning?: boolean;
  pickerColor?: string;
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
      canUndo,
      canRedo,
      compact,
      toolsDisabled,
      confirmDisabled,
      ocrDisabled,
      ocrRunning,
      pickerColor,
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
    const toggle = (next: Exclude<AnnotTool, null>) => onToolChange(tool === next ? null : next);
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
              label={t.toolbar.rectangle}
              active={tool === "rect"}
              disabled={locked}
              onClick={() => toggle("rect")}
            >
              <Square {...iconProps} />
            </TooltipButton>
            <TooltipButton
              label={t.toolbar.ellipse}
              active={tool === "ellipse"}
              disabled={locked}
              onClick={() => toggle("ellipse")}
            >
              <Circle {...iconProps} />
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
            {pickerColor && (
              <span className="picker-color-chip" style={{ backgroundColor: pickerColor }} />
            )}
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
