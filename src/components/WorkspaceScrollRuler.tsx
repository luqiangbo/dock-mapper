import {
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from "react";
import { Slider } from "antd";
import { observeWorkspaceScroll, scrollOffset } from "./workspaceScroll";
import { createRulerActivity } from "./rulerActivity";
import styles from "./WorkspaceScrollRuler.module.scss";

export default function WorkspaceScrollRuler({
  contentRef,
  pageKey,
}: {
  contentRef: RefObject<HTMLDivElement | null>;
  pageKey: string;
}) {
  const [position, setPosition] = useState({ pageKey, percent: 0, overflowing: false });
  const [interaction] = useState(createRulerActivity);
  const activity = useSyncExternalStore(
    interaction.subscribe,
    interaction.getSnapshot,
    interaction.getSnapshot,
  );
  const visible = position.pageKey === pageKey && position.overflowing;
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
      style={{ "--ruler-position": `${position.percent}%` } as CSSProperties}
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
      <div className={styles.scale}>
        <Slider
          orientation="vertical"
          reverse
          min={0}
          max={100}
          step={0.1}
          value={position.percent}
          included={false}
          tooltip={{
            open: visible && activity.active,
            formatter: (value) => `${Math.round(value ?? 0)}%`,
            placement: "left",
            autoAdjustOverflow: true,
            zIndex: 20,
            getPopupContainer: (trigger) => trigger.closest<HTMLElement>("aside") ?? document.body,
            rootClassName: styles.tooltip,
          }}
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
