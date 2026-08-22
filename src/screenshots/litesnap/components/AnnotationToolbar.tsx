import {
  ArrowUpRight,
  Check,
  Circle,
  Crop,
  Grid3X3,
  Highlighter,
  ListOrdered,
  PenLine,
  Pin,
  Pipette,
  QrCode,
  Save,
  ScanText,
  ScrollText,
  Type,
  Undo2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
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
  toolsDisabled?: boolean;
  scrollCaptureDisabled?: boolean;
  confirmDisabled?: boolean;
  ocrDisabled?: boolean;
  ocrRunning?: boolean;
  pickerColor?: string;
  onToolChange: (tool: AnnotTool) => void;
  onUndo: () => void;
  onScrollCapture: () => void;
  onSave: () => void;
  onPin: () => void;
  onOcr: () => void;
  onQr: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  options?: ReactNode;
  style?: React.CSSProperties;
}

function AnnotationToolbar({
  tool,
  canUndo,
  toolsDisabled,
  scrollCaptureDisabled,
  confirmDisabled,
  ocrDisabled,
  ocrRunning,
  pickerColor,
  onToolChange,
  onUndo,
  onScrollCapture,
  onSave,
  onPin,
  onOcr,
  onQr,
  onCancel,
  onConfirm,
  options,
  style,
}: AnnotationToolbarProps): React.JSX.Element {
  const { t } = useI18n();
  const locked = Boolean(toolsDisabled);
  const toggle = (next: Exclude<AnnotTool, null>) => onToolChange(tool === next ? null : next);
  const iconProps = { size: 18, strokeWidth: 2.6, "aria-hidden": true };

  return (
    <div className="wx-toolbar" style={style} onMouseDown={(event) => event.stopPropagation()}>
      <div className="wx-toolbar__row">
        <div className="wx-toolbar__group">
          <TooltipButton
            label={t.toolbar.rectangle}
            active={tool === "rect"}
            disabled={locked}
            onClick={() => toggle("rect")}
          >
            <Crop {...iconProps} />
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
          <TooltipButton
            label={ocrRunning ? "正在识别文字" : "识别文字（当前 OCR 引擎）"}
            disabled={locked || ocrDisabled}
            onClick={onOcr}
          >
            <ScanText {...iconProps} className={ocrRunning ? "toolbar-icon--spin" : undefined} />
          </TooltipButton>
          <TooltipButton label="识别二维码" disabled={locked || ocrDisabled} onClick={onQr}>
            <QrCode {...iconProps} />
          </TooltipButton>
        </div>

        <div className="wx-toolbar__divider" />
        <div className="wx-toolbar__group">
          <TooltipButton
            label={t.toolbar.scrollCapture}
            disabled={locked || scrollCaptureDisabled}
            onClick={onScrollCapture}
          >
            <ScrollText {...iconProps} />
          </TooltipButton>
        </div>
        <div className="wx-toolbar__divider" />
        <div className="wx-toolbar__group">
          <TooltipButton label={t.toolbar.undo} disabled={locked || !canUndo} onClick={onUndo}>
            <Undo2 {...iconProps} />
          </TooltipButton>
          <TooltipButton
            label={t.toolbar.save}
            disabled={locked || confirmDisabled}
            onClick={onSave}
          >
            <Save {...iconProps} />
          </TooltipButton>
          <TooltipButton label={t.toolbar.pin} disabled={locked || confirmDisabled} onClick={onPin}>
            <Pin {...iconProps} />
          </TooltipButton>
        </div>
        <div className="wx-toolbar__divider" />
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
      {options && <div className="wx-toolbar__options-row">{options}</div>}
    </div>
  );
}

export default AnnotationToolbar;
