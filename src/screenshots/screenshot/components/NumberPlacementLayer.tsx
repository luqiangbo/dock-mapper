import { useEffect, useRef, useState } from "react";
import { Spin } from "antd";
import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { NumberStyle } from "./annotationTypes";
import { addNumberBadge, loadNumberFont } from "./numberBadge";

export function NumberPlacementLayer({
  api,
  base,
  style,
  onError,
}: {
  api: ExcalidrawImperativeAPI;
  base: HTMLCanvasElement;
  style: NumberStyle;
  onError: (message: string) => void;
}) {
  const active = useRef(true);
  const pending = useRef(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return (
    <div
      className="screenshot-special-layer"
      aria-label="单击放置序号"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const point = viewportCoordsToSceneCoords(
          { clientX: event.clientX, clientY: event.clientY },
          api.getAppState(),
        );
        const background = api.getSceneElements().find((element) => element.locked)?.id;
        pending.current += 1;
        setLoading(true);
        void loadNumberFont()
          .then(() => {
            if (
              !active.current ||
              api.getSceneElements().find((element) => element.locked)?.id !== background
            )
              return;
            addNumberBadge(api, base, point, style);
          })
          .catch((error) => {
            if (active.current) onError(`添加序号失败，请再次单击重试：${String(error)}`);
          })
          .finally(() => {
            pending.current -= 1;
            if (active.current) setLoading(pending.current > 0);
          });
      }}
    >
      {loading && (
        <div className="special-tool-feedback">
          <Spin size="small" />
          正在准备序号…
        </div>
      )}
    </div>
  );
}
