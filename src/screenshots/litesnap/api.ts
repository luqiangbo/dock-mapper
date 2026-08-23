import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ScreenshotConfig } from "../../types";

export interface FullScreenshot {
  url: string;
  generation: number;
  displayWidth: number;
  displayHeight: number;
  imageWidth: number;
  imageHeight: number;
  overlayLabel: string;
}

export interface OcrResult {
  text: string;
  engine: "onnx";
}

export interface QrDecodeResult {
  contents: string[];
}

export interface Api {
  closeOverlay: () => void;
  showCaptureOverlay: (generation?: number) => Promise<boolean>;
  overlayReady: (label: string) => Promise<void>;
  getFullScreenshot: (label: string) => Promise<FullScreenshot>;
  reportCaptureRendered: (generation: number, label: string) => Promise<boolean>;
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
  closeOverlay: () => void invoke("close_overlay"),
  showCaptureOverlay: (generation) => invoke("show_capture_overlay", { generation }),
  overlayReady: (label) => invoke("overlay_ready", { label }),
  getFullScreenshot: (label) => invoke("get_full_screenshot", { label }),
  reportCaptureRendered: (generation, label) =>
    invoke("report_capture_rendered", { generation, label }),
  onCaptureReady: (callback) => subscribe("capture-ready", callback),
  checkScreenPermission: () => invoke("check_screen_permission"),
  uploadImage: (png) => invoke("upload_image", png),
  releaseImage: (imageId) => invoke("release_image", { imageId }),
  copyImage: (imageId) => invoke("copy_image", { imageId }),
  copyText: (value) => invoke("copy_text", { value }),
  saveImage: (imageId) => invoke("save_image", { imageId }),
  pinImage: (imageId) => invoke("pin_image", { imageId }),
  recognizeSelection: (imageId) => invoke("recognize_selection", { imageId }),
  decodeQrSelection: (imageId) => invoke("decode_qr_selection", { imageId }),
  openUrl: (url) => invoke("open_url", { url }),
  getScreenshotConfig: () => invoke("get_screenshot_config"),
  updateScreenshotConfig: (config) =>
    invoke("update_screenshot_config", { screenshotConfig: config }),
};

declare global {
  interface Window {
    api: Api;
  }
}

window.api = api;
