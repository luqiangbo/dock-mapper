import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AnnotationOutlineConfig,
  ScreenshotAnnotationStyles,
  ScreenshotConfig,
} from "../../types";
import { invokeCommand } from "../../api/ipc";
import type {
  CaptureSelectionTrace,
  FullScreenshot,
  OcrResult,
  QrDecodeResult,
  ScreenshotHistorySummary,
} from "../../api/screenshotTypes";

export type {
  FullScreenshot,
  OcrResult,
  OcrTextBlock,
  QrDecodeResult,
  ScreenshotHistorySummary,
  WindowCandidate,
} from "../../api/screenshotTypes";

export interface Api {
  closeOverlay: () => void;
  showCaptureOverlay: (generation?: number) => Promise<boolean>;
  overlayReady: (label: string) => Promise<void>;
  getFullScreenshot: (label: string) => Promise<FullScreenshot>;
  reportCaptureRendered: (
    generation: number,
    label: string,
    trace?: CaptureSelectionTrace,
  ) => Promise<boolean>;
  onCaptureReady: (callback: (label: string) => void) => () => void;
  checkScreenPermission: () => Promise<{ granted: boolean; status: string }>;
  uploadImage: (png: Uint8Array) => Promise<string>;
  releaseImage: (imageId: string) => Promise<void>;
  copyImage: (imageId: string) => Promise<boolean>;
  copyText: (value: string) => Promise<boolean>;
  saveImage: (imageId: string) => Promise<boolean>;
  pinImage: (imageId: string) => Promise<string>;
  recognizeSelection: (imageId: string) => Promise<OcrResult>;
  decodeQrSelection: (imageId: string) => Promise<QrDecodeResult>;
  openUrl: (url: string) => Promise<boolean>;
  getScreenshotConfig: () => Promise<ScreenshotConfig>;
  updateScreenshotConfig: (config: ScreenshotConfig) => Promise<ScreenshotConfig>;
  updateScreenshotAnnotationColor: (color: string) => Promise<string>;
  updateScreenshotAnnotationOutline: (
    outline: AnnotationOutlineConfig,
  ) => Promise<AnnotationOutlineConfig>;
  updateScreenshotAnnotationStyles: (
    styles: ScreenshotAnnotationStyles,
  ) => Promise<ScreenshotAnnotationStyles>;
  createScreenshotHistory: (resultImageId: string) => Promise<ScreenshotHistorySummary>;
}

function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  let disposed = false;
  let unlisten: UnlistenFn | undefined;
  void listen<T>(event, ({ payload }) => callback(payload)).then((off) => {
    if (disposed) off();
    else unlisten = off;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

export const api: Api = {
  closeOverlay: () => void invokeCommand("close_overlay"),
  showCaptureOverlay: (generation) => invokeCommand("show_capture_overlay", { generation }),
  overlayReady: (label) => invokeCommand("overlay_ready", { label }),
  getFullScreenshot: (label) => invokeCommand("get_full_screenshot", { label }),
  reportCaptureRendered: (generation, label, trace) =>
    invokeCommand("report_capture_rendered", { generation, label, trace }),
  onCaptureReady: (callback) => subscribe("capture-ready", callback),
  checkScreenPermission: () => invokeCommand("check_screen_permission"),
  uploadImage: (png) => invokeCommand("upload_image", png),
  releaseImage: (imageId) => invokeCommand("release_image", { imageId }),
  copyImage: (imageId) => invokeCommand("copy_image", { imageId }),
  copyText: (value) => invokeCommand("copy_text", { value }),
  saveImage: (imageId) => invokeCommand("save_image", { imageId }),
  pinImage: (imageId) => invokeCommand("pin_image", { imageId }),
  recognizeSelection: (imageId) => invokeCommand("recognize_selection", { imageId }),
  decodeQrSelection: (imageId) => invokeCommand("decode_qr_selection", { imageId }),
  openUrl: (url) => invokeCommand("open_url", { url }),
  getScreenshotConfig: () => invokeCommand("get_screenshot_config"),
  updateScreenshotConfig: (config) =>
    invokeCommand("update_screenshot_config", { screenshotConfig: config }),
  updateScreenshotAnnotationColor: (color) =>
    invokeCommand("update_screenshot_annotation_color", { color }),
  updateScreenshotAnnotationOutline: (outline) =>
    invokeCommand("update_screenshot_annotation_outline", { outline }),
  updateScreenshotAnnotationStyles: (styles) =>
    invokeCommand("update_screenshot_annotation_styles", { styles }),
  createScreenshotHistory: (resultImageId) =>
    invokeCommand("create_screenshot_history", { resultImageId }),
};

declare global {
  interface Window {
    api: Api;
  }
}

window.api = api;
