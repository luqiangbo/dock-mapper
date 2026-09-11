import { Select } from "antd";
import {
  ARROW_BRUSH_GROUPS,
  ARROW_BRUSH_PRESETS,
  type ArrowBrushId,
} from "./arrowBrushPresets";

interface ArrowBrushPickerProps {
  value: ArrowBrushId;
  onChange: (value: ArrowBrushId) => void;
  onOpenChange: (open: boolean) => void;
}

/** Text-only options keep rendering availability independent from WebGL previews. */
export default function ArrowBrushPicker({
  value,
  onChange,
  onOpenChange,
}: ArrowBrushPickerProps): React.JSX.Element {
  const options = ARROW_BRUSH_GROUPS.map((group) => ({
    label: group,
    options: ARROW_BRUSH_PRESETS.filter((preset) => preset.group === group).map((preset) => ({
      value: preset.id,
      label: preset.label,
    })),
  }));
  return (
    <Select
      size="small"
      aria-label="笔刷"
      value={value}
      options={options}
      style={{ width: 112 }}
      popupMatchSelectWidth={false}
      onOpenChange={onOpenChange}
      onChange={onChange}
    />
  );
}
