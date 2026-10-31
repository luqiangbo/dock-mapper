import { useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Selection } from "./useCaptureLifecycle";
import { HANDLE_CURSORS, type ResizeHandle } from "../components/selectionGeometry";
import { SelectionDragSession } from "../components/selectionDrag";

type Handle = ResizeHandle | "move";
export function useSelectionDrag<Baseline>(options: {
  enabled: boolean;
  blocked: boolean;
  generation: number;
  selection: Selection | null;
  createBaseline: () => Baseline | null;
  resolve: (origin: Selection, handle: Handle, dx: number, dy: number) => Selection;
  commit: (selection: Selection, baseline: Baseline) => void;
  clickBlank: () => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const [preview, setPreview] = useState<Selection | null>(null);
  const [space, setSpace] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [moveHovered, setMoveHovered] = useState(false);
  const heldSpace = useRef(false),
    suppressUntil = useRef(0);
  const drag = useRef<{
    pointer: number;
    target: HTMLElement;
    x: number;
    y: number;
    gesture: SelectionDragSession;
    baseline: Baseline;
    handle: Handle;
    generation: number;
  } | null>(null);
  useLayoutEffect(() => {
    let frame = 0,
      composing = false;
    const release = () => {
      const current = drag.current;
      drag.current = null;
      if (current?.target.hasPointerCapture(current.pointer))
        current.target.releasePointerCapture(current.pointer);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      setPreview(null);
      setCursor(null);
      return current;
    };
    const resolve = (event: PointerEvent) => {
      const current = drag.current,
        o = latest.current;
      if (!current || current.pointer !== event.pointerId || current.generation !== o.generation)
        return;
      const dx = event.clientX - current.x,
        dy = event.clientY - current.y;
      if (
        !current.gesture.update(dx, dy, (origin, dx, dy) =>
          o.resolve(origin, current.handle, dx, dy),
        )
      )
        return;
      return current;
    };
    const move = (event: PointerEvent) => {
      if (!resolve(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (drag.current?.gesture.moved) setPreview(drag.current.gesture.next);
        });
    };
    const up = (event: PointerEvent) => {
      if (drag.current?.pointer !== event.pointerId) return;
      resolve(event);
      event.preventDefault();
      event.stopImmediatePropagation();
      const current = release(),
        o = latest.current;
      if (!current || current.generation !== o.generation) return;
      const committed = current.gesture.finish();
      if (committed) {
        suppressUntil.current = performance.now() + 650;
        o.commit(committed, current.baseline);
      } else if (current.handle === "move") o.clickBlank();
    };
    const cancel = () => {
      if (drag.current?.gesture.moved) suppressUntil.current = performance.now() + 650;
      drag.current?.gesture.finish(true);
      release();
    };
    const pointerCancel = (event: PointerEvent) => {
      if (drag.current?.pointer === event.pointerId) cancel();
    };
    const blur = () => {
      heldSpace.current = false;
      setSpace(false);
      setMoveHovered(false);
      cancel();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && drag.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
        return;
      }
      const o = latest.current;
      if (
        !o.enabled ||
        o.blocked ||
        composing ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        (event.target instanceof Element &&
          event.target.closest(
            'input,textarea,button,select,[role="button"],[contenteditable="true"],.wx-toolbar,.tool-options,.ant-modal,.ant-dropdown,.ant-popover,[data-picker-controls]',
          ))
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        event.stopImmediatePropagation();
        heldSpace.current = true;
        setSpace(true);
      } else if (drag.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space" && heldSpace.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        heldSpace.current = false;
        setSpace(false);
      }
    };
    const beginComposition = () => {
        composing = true;
        blur();
      },
      endComposition = () => {
        composing = false;
      };
    window.addEventListener("pointermove", move, { capture: true, passive: false });
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", pointerCancel, true);
    window.addEventListener("lostpointercapture", pointerCancel, true);
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("keyup", keyup, true);
    window.addEventListener("blur", blur);
    window.addEventListener("compositionstart", beginComposition, true);
    window.addEventListener("compositionend", endComposition, true);
    return () => {
      release();
      heldSpace.current = false;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", pointerCancel, true);
      window.removeEventListener("lostpointercapture", pointerCancel, true);
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("compositionstart", beginComposition, true);
      window.removeEventListener("compositionend", endComposition, true);
    };
  }, [options.generation]);
  return {
    preview,
    space,
    cursor,
    moveHovered,
    hoverMove: setMoveHovered,
    spaceHeld: () => heldSpace.current,
    suppressDoubleClick: () => performance.now() < suppressUntil.current,
    start: (handle: Handle, event: ReactPointerEvent<HTMLElement>) => {
      const o = latest.current;
      if (!o.enabled || o.blocked || !o.selection || event.button !== 0 || drag.current) return;
      const baseline = o.createBaseline();
      if (!baseline) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setCursor(handle === "move" ? "move" : HANDLE_CURSORS[handle]);
      drag.current = {
        pointer: event.pointerId,
        target: event.currentTarget,
        x: event.clientX,
        y: event.clientY,
        gesture: new SelectionDragSession(o.selection),
        baseline,
        handle,
        generation: o.generation,
      };
    },
  };
}
