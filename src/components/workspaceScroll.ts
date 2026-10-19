export interface ScrollDimensions {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}

export function scrollRange({ scrollHeight, clientHeight }: ScrollDimensions) {
  return Math.max(0, scrollHeight - clientHeight);
}

export function scrollPercent(dimensions: ScrollDimensions) {
  const range = scrollRange(dimensions);
  return range > 0 ? Math.max(0, Math.min(100, (dimensions.scrollTop / range) * 100)) : 0;
}

export function scrollOffset(dimensions: ScrollDimensions, percent: number) {
  return (Math.max(0, Math.min(100, percent)) / 100) * scrollRange(dimensions);
}

/** Scroll and size notifications share one frame; the scroll container is authoritative. */
export function observeWorkspaceScroll(
  element: HTMLElement,
  publish: (state: { percent: number; overflowing: boolean }) => void,
  onScroll?: () => void,
) {
  let frame: number | undefined;
  let measured = false;
  let scrolled = false;
  let previousTop = element.scrollTop;
  const measure = () => {
    frame = undefined;
    publish({ percent: scrollPercent(element), overflowing: scrollRange(element) > 0 });
    if (measured && scrolled && previousTop !== element.scrollTop && scrollRange(element) > 0)
      onScroll?.();
    previousTop = element.scrollTop;
    measured = true;
    scrolled = false;
  };
  const schedule = () => {
    frame ??= requestAnimationFrame(measure);
  };
  const observer = new ResizeObserver(schedule);
  observer.observe(element);
  if (element.firstElementChild) observer.observe(element.firstElementChild);
  const handleScroll = () => {
    scrolled = true;
    schedule();
  };
  element.addEventListener("scroll", handleScroll, { passive: true });
  window.addEventListener("resize", schedule);
  // Defer until parent layout effects have restored this page's saved scroll position.
  schedule();
  return () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    observer.disconnect();
    element.removeEventListener("scroll", handleScroll);
    window.removeEventListener("resize", schedule);
  };
}
