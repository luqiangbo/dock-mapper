import {
  memo,
  useLayoutEffect,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from "react";
import { Slider } from "antd";
import { observeWorkspaceScroll, scrollOffset } from "./workspaceScroll";
import { createRulerActivity } from "./rulerActivity";
import { createRulerWaves } from "./rulerWaves";
import styles from "./WorkspaceScrollRuler.module.scss";
import { createSettledRenderQueue, windowResizeActivity } from "../windowResizeActivity";

export default function WorkspaceScrollRuler({
  contentRef,
  pageKey,
}: {
  contentRef: RefObject<HTMLDivElement | null>;
  pageKey: string;
}) {
  const [position, setPosition] = useState({ pageKey, percent: 0, overflowing: false });
  const [interaction] = useState(createRulerActivity);
  const scaleRef = useRef<HTMLDivElement>(null);
  const [waveGeometry, setWaveGeometry] = useState({ height: 0, percent: 0 });
  const positionRef = useRef(position.percent);
  positionRef.current = position.percent;
  const waveQueue = useRef<ReturnType<typeof createSettledRenderQueue> | null>(null);
  const [waveSeed] = useState(() => Math.floor(Math.random() * 0x100000000));
  const resizing = useSyncExternalStore(
    windowResizeActivity.subscribe,
    windowResizeActivity.getSnapshot,
  );
  const waves = useMemo(
    () => createRulerWaves(waveGeometry.height, waveGeometry.percent, waveSeed),
    [waveGeometry.height, waveGeometry.percent, waveSeed],
  );
  const [motionVisible, setMotionVisible] = useState(false);
  useEffect(() => {
    const syncVisibility = () => setMotionVisible(!document.hidden && document.hasFocus());
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    window.addEventListener("focus", syncVisibility);
    window.addEventListener("blur", syncVisibility);
    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      window.removeEventListener("focus", syncVisibility);
      window.removeEventListener("blur", syncVisibility);
    };
  }, []);
  const activity = useSyncExternalStore(
    interaction.subscribe,
    interaction.getSnapshot,
    interaction.getSnapshot,
  );
  const visible = position.pageKey === pageKey && position.overflowing;
  useLayoutEffect(() => {
    const scale = scaleRef.current;
    if (!scale || !visible) return;
    const queue = createSettledRenderQueue(windowResizeActivity, () => {
      const next = { height: scale.clientHeight, percent: positionRef.current };
      setWaveGeometry((previous) =>
        previous.height === next.height && previous.percent === next.percent ? previous : next,
      );
    });
    waveQueue.current = queue;
    const observer = new ResizeObserver(() => queue.request());
    observer.observe(scale);
    queue.request();
    return () => {
      observer.disconnect();
      queue.dispose();
      waveQueue.current = null;
    };
  }, [visible]);
  useLayoutEffect(() => {
    waveQueue.current?.request();
  }, [position.percent]);
  useLayoutEffect(() => {
    interaction.reset();
    const content = contentRef.current;
    if (!content) return;
    const stop = observeWorkspaceScroll(
      content,
      (next) => {
        interaction.setOverflowing(next.overflowing);
        setPosition((previous) =>
          previous.pageKey === pageKey &&
          previous.percent === next.percent &&
          previous.overflowing === next.overflowing
            ? previous
            : { ...next, pageKey },
        );
      },
      interaction.scroll,
    );
    const finishDrag = () => interaction.set("dragging", false);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    window.addEventListener("blur", finishDrag);
    return () => {
      stop();
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      window.removeEventListener("blur", finishDrag);
      interaction.reset();
    };
  }, [contentRef, pageKey, interaction]);

  return (
    <aside
      className={styles.ruler}
      hidden={!visible}
      data-active={visible && activity.active}
      data-expanded={visible && activity.expanded}
      data-motion={visible && motionVisible && !resizing}
      aria-label="页面滚动位置"
      onPointerEnter={() => interaction.set("hovered", true)}
      onPointerLeave={() => interaction.set("hovered", false)}
      onFocusCapture={(event) => interaction.set("focused", event.target.matches(":focus-visible"))}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) interaction.set("focused", false);
      }}
      onPointerDownCapture={(event) => {
        if (event.button === 0) {
          interaction.set("focused", false);
          interaction.set("dragging", true);
        }
      }}
      onKeyDownCapture={(event) => {
        interaction.set("focused", true);
        if (event.key !== "PageUp" && event.key !== "PageDown") return;
        const content = contentRef.current;
        if (!content) return;
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === "PageUp" ? -1 : 1;
        content.scrollBy({
          top: direction * Math.max(1, content.clientHeight - 72),
          behavior: "instant",
        });
      }}
    >
      <div className={styles.scale} ref={scaleRef}>
        <WaveBars waves={waves} />
        <Slider
          orientation="vertical"
          reverse
          min={0}
          max={100}
          step={0.1}
          value={position.percent}
          included={false}
          tooltip={{ open: false }}
          onChangeComplete={() => interaction.set("dragging", false)}
          ariaLabelForHandle="页面滚动位置"
          ariaValueTextFormatterForHandle={(value) => `已滚动 ${Math.round(value)}%`}
          onChange={(percent) => {
            const content = contentRef.current;
            if (content)
              content.scrollTo({ top: scrollOffset(content, percent), behavior: "instant" });
          }}
        />
      </div>
    </aside>
  );
}

const WaveBars = memo(function WaveBars({ waves }: { waves: ReturnType<typeof createRulerWaves> }) {
  return (
    <div className={styles.waves} aria-hidden="true">
      {waves.map((wave, index) => (
        <span
          key={index}
          className={styles.bar}
          style={
            {
              opacity: wave.opacity,
              animationDuration: `${wave.duration}s`,
              animationDelay: `${wave.delay}s`,
              "--wave-high": wave.high,
              ...Object.fromEntries(
                wave.frames.slice(0, 8).flatMap((frame, node) => [
                  [`--wave-size-${node}`, frame.scale],
                  [`--wave-offset-${node}`, `${frame.offset}px`],
                ]),
              ),
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
});
