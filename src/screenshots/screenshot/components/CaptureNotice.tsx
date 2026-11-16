import { createPortal } from "react-dom";
import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type ComponentProps,
} from "react";
import { captureNoticePosition, type NoticeBounds } from "./captureNoticePosition";
import { createCaptureNoticeState, createNoticePresentation } from "./captureNoticeState";
import "./captureNotice.css";

type Content = { children: ReactNode; error: boolean };
type Presentation = { notice: Content; instruction: Content | null };
const notices = createCaptureNoticeState<Content>();
const NoticeAnchor = createContext<{ bounds: NoticeBounds | null; moving: boolean }>({
  bounds: null,
  moving: false,
});

export function CaptureNoticeProvider({
  bounds = null,
  moving = false,
  children,
}: {
  bounds?: NoticeBounds | null;
  moving?: boolean;
  children: ReactNode;
}) {
  return (
    <NoticeAnchor.Provider value={{ bounds, moving }}>
      {children}
      <CaptureNoticeSurface />
    </NoticeAnchor.Provider>
  );
}

export function CaptureNoticeScope({
  bounds,
  moving = false,
  children,
  ...props
}: ComponentProps<"div"> & { bounds: NoticeBounds | null; moving?: boolean }) {
  return (
    <CaptureNoticeProvider bounds={bounds} moving={moving}>
      <div {...props}>{children}</div>
    </CaptureNoticeProvider>
  );
}

function host() {
  let element = document.getElementById("capture-notices");
  if (!element) {
    element = document.createElement("div");
    element.id = "capture-notices";
    element.className = "capture-notices";
    document.body.appendChild(element);
  }
  return element;
}

/** A single portal stays mounted through progress/result changes and capture drags. */
function CaptureNoticeSurface() {
  const { bounds, moving } = useContext(NoticeAnchor);
  useSyncExternalStore(notices.subscribe, notices.getVersion, notices.getVersion);
  const presentation = useRef(createNoticePresentation<Presentation>());
  const notice = notices.getContent();
  const content = presentation.current(
    notice
      ? {
          notice,
          instruction: notice.error ? null : notices.getHintContent(),
        }
      : null,
    moving,
  );
  const container = host();
  useLayoutEffect(() => {
    if (!content) return;
    const update = () => {
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const maxWidth = `${Math.max(1, Math.min(360, viewportWidth - 16))}px`;
      if (container.style.maxWidth !== maxWidth) container.style.maxWidth = maxWidth;
      const size = container.getBoundingClientRect();
      const reserved = [...document.querySelectorAll<HTMLElement>(".selection-size-panel")]
        .map((panel) => panel.getBoundingClientRect())
        .filter((panel) => panel.width > 0 && panel.height > 0)
        .map(({ x, y, width, height }) => ({ x, y, width, height }));
      const position = captureNoticePosition(
        bounds,
        { width: size.width, height: size.height, viewportWidth, viewportHeight },
        reserved,
      );
      if (container.style.left !== position.left) container.style.left = position.left;
      if (container.style.top !== position.top) container.style.top = position.top;
      container.dataset.outside = String(position.outside);
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(container);
    for (const panel of document.querySelectorAll(".selection-size-panel")) resize.observe(panel);
    window.addEventListener("resize", update);
    return () => {
      resize.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [!!content, bounds?.x, bounds?.y, bounds?.width, bounds?.height]);
  if (!content) return null;
  return createPortal(
    <div
      className={`capture-notice${content.notice.error ? " capture-notice--error" : ""}`}
      role={content.notice.error ? "alert" : "status"}
      aria-live={content.notice.error ? "assertive" : "polite"}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {content.instruction && content.instruction !== content.notice && (
        <span className="capture-notice__detail">{content.notice.children}</span>
      )}
      <span className="capture-notice__instruction">
        {(content.instruction ?? content.notice).children}
      </span>
    </div>,
    container,
  );
}

/** Register feedback; only the shared surface renders the selected message. */
export default function CaptureNotice({
  children,
  progress = false,
  error = false,
  hint = false,
}: {
  children: ReactNode;
  progress?: boolean;
  error?: boolean;
  hint?: boolean;
}) {
  const id = useId();
  useLayoutEffect(() => () => notices.remove(id), [id]);
  useLayoutEffect(() => {
    notices.register(id, { error, progress, hint }, { children, error });
  }, [id, error, progress, hint, children]);
  return null;
}
