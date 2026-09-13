export interface FullScreenshot {
  url: string;
  generation: number;
  displayWidth: number;
  displayHeight: number;
  imageWidth: number;
  imageHeight: number;
  overlayLabel: string;
  windowCandidates: WindowCandidate[];
  mode: "screenshot" | "quick_ocr";
}

export interface WindowCandidate {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

export interface CaptureSelectionTrace {
  stage: "pointer-down" | "manual-selection-start" | "pointer-up";
  pointerX: number;
  pointerY: number;
  selection: { x: number; y: number; width: number; height: number } | null;
  candidateId: string | null;
  dragMode: "candidate" | "manual";
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
}

export interface OcrResult {
  text: string;
  engine: "onnx";
  blocks: OcrTextBlock[];
}

export interface OcrTextBlock {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QrDecodeResult {
  contents: string[];
}

export interface ScreenshotHistorySummary {
  id: string;
  createdAtMs: number;
  width: number;
  height: number;
  favorite: boolean;
  totalBytes: number;
}

export interface PinOptions {
  opacity: number;
  locked: boolean;
}

export interface PinWindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  sequence: number;
}

export interface PinWindowGeometryRequest {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  sequence: number;
}

export interface WidgetLayoutBudget {
  allocatedWidth: number;
  constrained: boolean;
  visible: boolean;
}
