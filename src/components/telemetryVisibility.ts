interface VisibilityDocument {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/** Observe the WebView's lifecycle without a separate native visibility query. */
export function observeTelemetryVisibility(
  source: VisibilityDocument,
  publish: (visible: boolean) => void,
) {
  const refresh = () => publish(!source.hidden);
  source.addEventListener("visibilitychange", refresh);
  refresh();
  return {
    refresh,
    dispose: () => source.removeEventListener("visibilitychange", refresh),
  };
}
