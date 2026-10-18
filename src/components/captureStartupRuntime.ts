import { listen } from "@tauri-apps/api/event";
import { invokeCommand } from "../api/ipc";
import { createCaptureStartup, type CaptureStartState } from "./captureStartup";

export const captureStartup = createCaptureStartup();
let connecting: Promise<void> | null = null;
// One subscription for the lifetime of the main renderer, shared by the button,
// tray and shortcut feedback. Failed registrations are retryable.
export function connectCaptureStartup(): Promise<void> {
  if (!connecting)
    connecting = listen<CaptureStartState>("capture-start-state", ({ payload }) =>
      captureStartup.receive(payload),
    )
      .then(() => {})
      .catch((error) => {
        connecting = null;
        throw error;
      });
  return connecting;
}
export function startScreenshot() {
  return captureStartup.start(() => invokeCommand("start_screenshot"), connectCaptureStartup);
}
