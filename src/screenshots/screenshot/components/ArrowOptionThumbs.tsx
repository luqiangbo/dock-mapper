import { ARROW_STYLE_OPTIONS } from "./annotationTypes";

export interface ArrowOption {
  value: string | number;
  label: string;
}

export const ARROW_SHAPE_CHOICES: ArrowOption[] = [...ARROW_STYLE_OPTIONS];
