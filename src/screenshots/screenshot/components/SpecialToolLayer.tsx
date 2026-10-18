import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { NumberStyle } from "./annotationTypes";
import type { ColorCopyFormat } from "./pickerColor";
import { PickerLayer } from "./PickerLayer";
import { NumberPlacementLayer } from "./NumberPlacementLayer";
interface Props {
  tool: "number" | "picker";
  api: ExcalidrawImperativeAPI;
  base: HTMLCanvasElement;
  numberStyle: NumberStyle;
  format: ColorCopyFormat;
  keyboardBlocked?: boolean;
  onCopyColor: (color: string, formatted: string) => Promise<void>;
  onError: (message: string) => void;
}
export function SpecialToolLayer(props: Props) {
  return props.tool === "picker" ? (
    <PickerLayer
      api={props.api}
      base={props.base}
      format={props.format}
      keyboardBlocked={props.keyboardBlocked}
      onCopyColor={props.onCopyColor}
    />
  ) : (
    <NumberPlacementLayer
      api={props.api}
      base={props.base}
      style={props.numberStyle}
      onError={props.onError}
    />
  );
}
