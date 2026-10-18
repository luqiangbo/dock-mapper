import { useEffect, useRef, useState } from "react";
import { App as AntApp, Button, Image, Spin } from "antd";
import { errorMessage, historyApi } from "../api/commands";
import { createRequestQueue } from "../utils/requestQueue";
import styles from "./components.module.scss";
const thumbnailRequests = createRequestQueue(4);

export default function HistoryImage({ id, ids }: { id: string; ids?: string[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const thumbnailUrlRef = useRef("");
  const { notification } = AntApp.useApp();
  const [opening, setOpening] = useState(false);
  const [nearViewport, setNearViewport] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const [thumbnailAttempt, setThumbnailAttempt] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: "200px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [id]);

  useEffect(() => {
    if (!nearViewport) return;
    let disposed = false;
    let objectUrl = "";
    const controller = new AbortController();
    setFailed(false);
    void thumbnailRequests
      .run(() => historyApi.thumbnail(id), controller.signal)
      .then((payload) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(new Blob([payload], { type: "image/png" }));
        thumbnailUrlRef.current = objectUrl;
        setThumbnailUrl(objectUrl);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (thumbnailUrlRef.current === objectUrl) thumbnailUrlRef.current = "";
    };
  }, [id, nearViewport, thumbnailAttempt]);

  return (
    <div ref={hostRef} className={styles.historyImageHost}>
      {failed ? (
        <div className={styles.historyImageFallback}>
          <span>缩略图加载失败</span>
          <Button size="small" onClick={() => setThumbnailAttempt((attempt) => attempt + 1)}>
            重试
          </Button>
        </div>
      ) : !thumbnailUrl ? (
        nearViewport ? (
          <Spin size="small" />
        ) : null
      ) : (
        <Button
          type="text"
          className={styles.historyPreviewButton}
          aria-label="查看截图原图"
          disabled={opening}
          aria-busy={opening}
          onClick={() => {
            setOpening(true);
            void historyApi
              .openPreview(id, ids)
              .catch((error) =>
                notification.error({
                  message: "原图预览打开失败",
                  description: errorMessage(error),
                }),
              )
              .finally(() => setOpening(false));
          }}
        >
          <Image
            src={thumbnailUrl}
            alt="历史截图"
            className={styles.historyImage}
            preview={false}
            onError={() => {
              if (thumbnailUrlRef.current) URL.revokeObjectURL(thumbnailUrlRef.current);
              thumbnailUrlRef.current = "";
              setThumbnailUrl("");
              setFailed(true);
            }}
          />
          {opening && <span className={styles.historyOpening}>正在打开原图…</span>}
        </Button>
      )}
    </div>
  );
}
