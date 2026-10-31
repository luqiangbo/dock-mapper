import { useEffect, useRef } from "react";
import type { Selection } from "./useCaptureLifecycle";
import type { AnnotTool } from "../components/AnnotationToolbar";
import type { ToolSettings } from "../components/annotationTypes";
import type { CaptureExperience } from "../components/captureExperience";
import { captureWheelPatch, captureWheelTool } from "../components/captureWheel";
import { nudgeCaptureSelection } from "../components/captureInteraction";

export function useCaptureControls<Baseline>(options: {
  enabled: boolean;
  generation: number;
  blocked: boolean;
  selected: boolean;
  tool: AnnotTool;
  selectedTool: AnnotTool;
  settings: ToolSettings;
  selection: Selection | null;
  ratio: number | null;
  getImage: () => HTMLImageElement | null;
  createBaseline: () => Baseline | null;
  recrop: (selection: Selection, baseline: Baseline) => void;
  update: (patch: Partial<ToolSettings>, tool: AnnotTool, persist: boolean) => void;
  apply: (patch: Partial<ToolSettings>, commit: boolean) => void;
  experience: CaptureExperience;
}) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    let timer = 0;
    let pending: Partial<ToolSettings> = {};
    let lastUpdate: (() => void) | null = null;
    const nudge = (event: KeyboardEvent) => {
      const o = latest.current;
      if (
        !o.enabled ||
        o.blocked ||
        o.selected ||
        !o.selection ||
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.metaKey ||
        (event.target instanceof Element &&
          event.target.closest('input,textarea,[contenteditable="true"]')) ||
        !event.key.startsWith("Arrow")
      )
        return;
      const image = o.getImage(),
        baseline = o.createBaseline();
      if (!image || !baseline) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      o.recrop(
        nudgeCaptureSelection(
          o.selection,
          event.key,
          event.ctrlKey ? "expand" : event.shiftKey ? "shrink" : "move",
          image.naturalWidth,
          image.naturalHeight,
          window.innerWidth,
          window.innerHeight,
          o.ratio,
        ),
        baseline,
      );
    };
    const wheel = (event: WheelEvent) => {
      const o = latest.current;
      const tool = captureWheelTool(o.tool, o.selectedTool);
      if (
        !o.enabled ||
        o.blocked ||
        !tool ||
        tool === "select" ||
        tool === "picker" ||
        !event.deltaY ||
        !(event.target instanceof Element) ||
        !event.target.closest(".shot-viewport") ||
        event.target.closest(
          '.wx-toolbar,.tool-options,.ant-modal,.ant-dropdown,.ant-popover,input,textarea,[contenteditable="true"]',
        )
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // Wheel events can arrive before React renders; accumulate against the pending draft.
      const patch = captureWheelPatch(
        tool,
        { ...o.settings, ...pending },
        event.deltaY,
        event.ctrlKey,
      );
      if (!patch) return;
      pending = { ...pending, ...patch };
      o.update(patch, tool, false);
      o.apply(patch, true);
      const commit = pending;
      lastUpdate = () => o.update(commit, tool, true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        lastUpdate?.();
        lastUpdate = null;
        pending = {};
      }, 250);
    };
    window.addEventListener("keydown", nudge, true);
    window.addEventListener("wheel", wheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener("keydown", nudge, true);
      window.removeEventListener("wheel", wheel, true);
      window.clearTimeout(timer);
      if (options.generation === latest.current.generation) lastUpdate?.();
    };
  }, [options.generation, options.tool, options.selectedTool, options.blocked]);
}

export function useCaptureGuides(enabled: boolean) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0,
      x = 0,
      y = 0;
    const move = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          host.current?.style.setProperty("--guide-x", `${x}px`);
          host.current?.style.setProperty("--guide-y", `${y}px`);
        });
    };
    if (enabled) window.addEventListener("pointermove", move);
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return host;
}
