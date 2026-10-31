import { useEffect, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { NumberStyle } from "./annotationTypes";
import { addNumberBadge, loadNumberFont } from "./numberBadge";
import { nextNumber } from "./specialToolState";
import { numberPlacementPoint, isNumberPlacementClick } from "./numberPlacement";
import { NumberBadgePreview } from "./NumberBadgePreview";
type Placement = ReturnType<typeof numberPlacementPoint>;

export function NumberPlacementLayer({
  api,
  base,
  style,
  origin,
  onError,
}: {
  api: ExcalidrawImperativeAPI;
  base: HTMLCanvasElement;
  style: NumberStyle;
  origin: { x: number; y: number };
  onError: (message: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; pointer: number; dragged: boolean } | null>(null);
  const active = useRef(true),
    revision = useRef(0),
    queue = useRef(Promise.resolve());
  const lastClick = useRef<{ x: number; y: number; time: number } | null>(null);
  const frame = useRef(0);
  const [preparationError, setPreparationError] = useState("");
  const [hover, setHover] = useState<Placement | null>(null);
  const [next, setNext] = useState(style.start ?? 1),
    [pending, setPending] = useState(0);
  const pointAt = (x: number, y: number) =>
    root.current
      ? numberPlacementPoint({ x, y }, base, root.current.getBoundingClientRect(), origin)
      : null;
  useEffect(() => {
    const update = () => setNext(Math.max(style.start ?? 1, nextNumber(api.getSceneElements())));
    update();
    return api.onChange(update);
  }, [api, style.start]);
  useEffect(() => {
    active.current = true;
    setPending(0);
    setHover(null);
    lastClick.current = null;
    const cancel = () => {
      revision.current++;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      press.current = null;
      setHover(null);
      setPending(0);
    };
    const token = revision.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", onKeyDown);
    void loadNumberFont().catch(() => {
      if (active.current && token === revision.current)
        setPreparationError("序号字体暂不可用，单击重试");
    });
    return () => {
      active.current = false;
      revision.current++;
      cancelAnimationFrame(frame.current);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [api, base, origin.x, origin.y]);
  return (
    <div
      ref={root}
      className="screenshot-special-layer screenshot-number-layer"
      aria-label="单击放置序号，拖动不放置"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        press.current = {
          x: event.clientX,
          y: event.clientY,
          pointer: event.pointerId,
          dragged: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const x = event.clientX,
          y = event.clientY;
        if (press.current && !isNumberPlacementClick(press.current, { x, y }))
          press.current.dragged = true;
        if (frame.current) cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          frame.current = 0;
          if (press.current?.dragged) {
            setHover(null);
            return;
          }
          if (lastClick.current && isNumberPlacementClick(lastClick.current, { x, y })) return;
          const point = pointAt(x, y);
          setHover(point?.inside ? point : null);
        });
      }}
      onPointerLeave={() => {
        if (!press.current) {
          cancelAnimationFrame(frame.current);
          frame.current = 0;
          setHover(null);
        }
      }}
      onPointerCancel={() => {
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        press.current = null;
        setHover(null);
      }}
      onLostPointerCapture={() => {
        press.current = null;
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerUp={(event) => {
        const start = press.current;
        if (!start || start.pointer !== event.pointerId) return;
        press.current = null;
        event.preventDefault();
        event.stopPropagation();
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        setHover(null);
        setPreparationError("");
        const placement = pointAt(event.clientX, event.clientY);
        if (!placement) return;
        if (
          start.dragged ||
          !isNumberPlacementClick(start, { x: event.clientX, y: event.clientY }) ||
          !placement.inside
        ) {
          return;
        }
        const previous = lastClick.current;
        if (
          previous &&
          performance.now() - previous.time < 300 &&
          isNumberPlacementClick(previous, { x: event.clientX, y: event.clientY })
        )
          return;
        lastClick.current = { x: event.clientX, y: event.clientY, time: performance.now() };
        const token = revision.current;
        const background = api.getSceneElements().find((element) => element.locked)?.id;
        setPending((value) => value + 1);
        queue.current = queue.current
          .then(async () => {
            await loadNumberFont();
            if (
              !active.current ||
              token !== revision.current ||
              api.getSceneElements().find((element) => element.locked)?.id !== background
            )
              return;
            addNumberBadge(api, base, placement.point, style, undefined, origin, placement.zoom);
          })
          .catch((error) => {
            if (active.current && token === revision.current) {
              lastClick.current = null;
              onError("序号放置失败，请单击重试：" + String(error));
            }
          })
          .finally(() => {
            if (active.current && token === revision.current)
              setPending((value) => Math.max(0, value - 1));
          });
      }}
    >
      {preparationError && (
        <div className="special-tool-feedback" role="status">
          {preparationError}
        </div>
      )}
      {hover && (
        <div className="number-placement-preview" style={{ left: hover.left, top: hover.top }}>
          <NumberBadgePreview style={style} value={next + pending} size={style.size} />
        </div>
      )}
    </div>
  );
}
