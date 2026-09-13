import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { shouldCompactToolbar, type ToolbarSize } from "../components/toolbarLayout";

const EMPTY_SIZE: ToolbarSize = { width: 0, height: 0 };

export function useOverlayToolbarLayout(active: boolean, tool: string | null) {
  const primaryRef = useRef<HTMLDivElement>(null);
  const secondaryRef = useRef<HTMLDivElement>(null);
  const expandedWidth = useRef(0);
  const openPopups = useRef(new Set<string>());
  const [viewportSize, setViewportSize] = useState<ToolbarSize>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [primarySize, setPrimarySize] = useState<ToolbarSize>(EMPTY_SIZE);
  const [secondarySize, setSecondarySize] = useState<ToolbarSize>(EMPTY_SIZE);
  const [compact, setCompact] = useState(() => window.innerWidth < 680);
  const [popupOpen, setPopupOpen] = useState(false);

  const reportPopup = useCallback((source: string, open: boolean) => {
    if (open) openPopups.current.add(source);
    else openPopups.current.delete(source);
    setPopupOpen(openPopups.current.size > 0);
  }, []);

  const closePopups = useCallback(() => {
    openPopups.current.clear();
    setPopupOpen(false);
    setSecondarySize(EMPTY_SIZE);
  }, []);

  useEffect(() => {
    if (!active) closePopups();
  }, [active, closePopups]);

  useLayoutEffect(() => {
    if (!active) {
      setPrimarySize(EMPTY_SIZE);
      setSecondarySize(EMPTY_SIZE);
      return;
    }
    const measure = (): void => {
      const width = window.innerWidth;
      setViewportSize({ width, height: window.innerHeight });
      const primary = primaryRef.current;
      if (primary) {
        const rect = primary.getBoundingClientRect();
        setPrimarySize({ width: rect.width, height: rect.height });
        if (!compact) expandedWidth.current = Math.max(rect.width, primary.scrollWidth);
        const nextCompact = shouldCompactToolbar(width, expandedWidth.current || rect.width);
        if (nextCompact !== compact) setCompact(nextCompact);
      }
      const secondary = secondaryRef.current;
      setSecondarySize(
        secondary
          ? {
              width: secondary.getBoundingClientRect().width,
              height: secondary.getBoundingClientRect().height,
            }
          : EMPTY_SIZE,
      );
    };
    const observer = new ResizeObserver(measure);
    if (primaryRef.current) observer.observe(primaryRef.current);
    if (secondaryRef.current) observer.observe(secondaryRef.current);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [active, compact, tool]);

  return {
    primaryRef,
    secondaryRef,
    viewportSize,
    primarySize,
    secondarySize,
    compact,
    popupOpen,
    reportPopup,
    closePopups,
  };
}
