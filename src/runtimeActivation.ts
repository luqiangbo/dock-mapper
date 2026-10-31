import { invokeCommand, type NativeStartupStatus } from "./api/ipc";

declare const __DOCKMAPPER_DEFAULTS_BUILD_ID__: string;
let activation: Promise<void> | null = null;
export function activateRuntime() {
  if (!activation)
    activation = invokeCommand("initialize_defaults", {
      buildId: __DOCKMAPPER_DEFAULTS_BUILD_ID__,
      activate: true,
    })
      .then((result) => {
        if (result.restartRequired) throw new Error("应用版本已变化，请退出后重新打开");
      })
      .catch((error) => {
        activation = null;
        throw error;
      });
  return activation;
}

export function acceptStartupStatus(
  current: NativeStartupStatus | null,
  next: NativeStartupStatus,
) {
  if (
    current &&
    (next.generation < current.generation ||
      (next.generation === current.generation &&
        current.phase !== "initializing" &&
        next.phase !== current.phase))
  )
    return current;
  return next;
}
