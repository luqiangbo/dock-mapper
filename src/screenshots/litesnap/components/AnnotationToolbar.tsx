import {
  AimOutlined,
  ArrowUpOutlined,
  BgColorsOutlined,
  BlockOutlined,
  BorderOutlined,
  CheckOutlined,
  CloseOutlined,
  DownloadOutlined,
  EditOutlined,
  FontSizeOutlined,
  FileSearchOutlined,
  HighlightOutlined,
  PushpinOutlined,
  RollbackOutlined,
  SmileOutlined,
  VerticalAlignBottomOutlined,
} from "@ant-design/icons";
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
  | "emoji"
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

export function toolUsesColor(tool: AnnotTool): boolean {
  return ["rect", "ellipse", "arrow", "pen", "highlight", "text"].includes(tool ?? "");
}

interface AnnotationToolbarProps {
  tool: AnnotTool;
  canUndo: boolean;
  toolsDisabled?: boolean;
  scrollCaptureDisabled?: boolean;
  confirmDisabled?: boolean;
  ocrDisabled?: boolean;
  ocrRunning?: boolean;
  showEmojiPicker?: boolean;
  pickerColor?: string;
  onToolChange: (tool: AnnotTool) => void;
  onUndo: () => void;
  onScrollCapture: () => void;
  onSave: () => void;
  onPin: () => void;
  onOcr: () => void;
  onCancel: () => void;
  onConfirm: () => void;
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
  showEmojiPicker,
  pickerColor,
  onToolChange,
  onUndo,
  onScrollCapture,
  onSave,
  onPin,
  onOcr,
  onCancel,
  onConfirm,
  style,
}: AnnotationToolbarProps): React.JSX.Element {
  const { t } = useI18n();
  const locked = Boolean(toolsDisabled);
  const toggle = (next: Exclude<AnnotTool, null>) => onToolChange(tool === next ? null : next);

  return (
    <div className="wx-toolbar" style={style} onMouseDown={(event) => event.stopPropagation()}>
      <div className="wx-toolbar__group">
        <TooltipButton
          label={t.toolbar.rectangle}
          active={tool === "rect"}
          disabled={locked}
          onClick={() => toggle("rect")}
        >
          <BorderOutlined />
        </TooltipButton>
        <TooltipButton
          label={t.toolbar.ellipse}
          active={tool === "ellipse"}
          disabled={locked}
          onClick={() => toggle("ellipse")}
        >
          <AimOutlined />
        </TooltipButton>
        <TooltipButton
          label={t.toolbar.emojiSticker}
          active={tool === "emoji" || showEmojiPicker}
          disabled={locked}
          onClick={() => toggle("emoji")}
        >
          <SmileOutlined />
        </TooltipButton>
        <TooltipButton
          label={t.toolbar.arrow}
          active={tool === "arrow"}
          disabled={locked}
          onClick={() => toggle("arrow")}
        >
          <ArrowUpOutlined className="toolbar-arrow-icon" />
        </TooltipButton>
        <TooltipButton
          label={t.toolbar.pen}
          active={tool === "pen"}
          disabled={locked}
          onClick={() => toggle("pen")}
        >
          <EditOutlined />
        </TooltipButton>
        <TooltipButton
          label={t.toolbar.highlight}
          active={tool === "highlight"}
          disabled={locked}
          onClick={() => toggle("highlight")}
        >
          <HighlightOutlined />
        </TooltipButton>
        <TooltipButton
          label={t.toolbar.mosaic}
          active={tool === "mosaic"}
          disabled={locked}
          onClick={() => toggle("mosaic")}
        >
          <BlockOutlined />
        </TooltipButton>
        <TooltipButton
          label={t.toolbar.text}
          active={tool === "text"}
          disabled={locked}
          onClick={() => toggle("text")}
        >
          <FontSizeOutlined />
        </TooltipButton>
        <TooltipButton
          label={t.toolbar.picker}
          active={tool === "picker"}
          disabled={locked}
          onClick={() => toggle("picker")}
        >
          <BgColorsOutlined />
        </TooltipButton>
        {pickerColor && (
          <span className="picker-color-chip" style={{ backgroundColor: pickerColor }} />
        )}
        <TooltipButton
          label={ocrRunning ? "正在并行识别文字" : "对比识别文字（双离线 OCR）"}
          disabled={locked || ocrDisabled}
          onClick={onOcr}
        >
          <FileSearchOutlined spin={ocrRunning} />
        </TooltipButton>
      </div>

      <div className="wx-toolbar__divider" />
      <div className="wx-toolbar__group">
        <TooltipButton
          label={t.toolbar.scrollCapture}
          disabled={locked || scrollCaptureDisabled}
          onClick={onScrollCapture}
        >
          <VerticalAlignBottomOutlined />
        </TooltipButton>
      </div>
      <div className="wx-toolbar__divider" />
      <div className="wx-toolbar__group">
        <TooltipButton label={t.toolbar.undo} disabled={locked || !canUndo} onClick={onUndo}>
          <RollbackOutlined />
        </TooltipButton>
        <TooltipButton label={t.toolbar.save} disabled={locked || confirmDisabled} onClick={onSave}>
          <DownloadOutlined />
        </TooltipButton>
        <TooltipButton label={t.toolbar.pin} disabled={locked || confirmDisabled} onClick={onPin}>
          <PushpinOutlined />
        </TooltipButton>
      </div>
      <div className="wx-toolbar__divider" />
      <div className="wx-toolbar__group">
        <TooltipButton label={t.toolbar.cancel} danger onClick={onCancel}>
          <CloseOutlined />
        </TooltipButton>
        <TooltipButton
          label={t.toolbar.done}
          success
          disabled={confirmDisabled}
          onClick={onConfirm}
        >
          <CheckOutlined />
        </TooltipButton>
      </div>
    </div>
  );
}

export default AnnotationToolbar;
