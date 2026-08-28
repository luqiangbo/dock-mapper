import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CopyOutlined,
  DeleteOutlined,
  PushpinOutlined,
  ReloadOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons";
import { App as AntApp, Button, Empty, Image, Popconfirm, Spin, Tooltip, Typography } from "antd";
import type { ScreenshotHistorySummary } from "../screenshots/litesnap/api";
import { copyBinaryPayload } from "../screenshots/litesnap/utils/binaryPayload";
import styles from "./components.module.scss";

const { Text } = Typography;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

type HistoryAction = "copy" | "pin" | "favorite" | "delete";

function HistoryImage({ id }: { id: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const thumbnailUrlRef = useRef("");
  const originalUrlRef = useRef("");
  const [nearViewport, setNearViewport] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [originalUrl, setOriginalUrl] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [failed, setFailed] = useState(false);

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
    void invoke<unknown>("get_screenshot_history_thumbnail", { id })
      .then((payload) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(
          new Blob([copyBinaryPayload(payload)], { type: "image/png" }),
        );
        thumbnailUrlRef.current = objectUrl;
        setThumbnailUrl(objectUrl);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (thumbnailUrlRef.current === objectUrl) thumbnailUrlRef.current = "";
    };
  }, [id, nearViewport]);

  useEffect(() => {
    if (!previewOpen || originalUrlRef.current) return;
    let disposed = false;
    void invoke<unknown>("get_screenshot_history_image", { id })
      .then((payload) => {
        if (disposed) return;
        const objectUrl = URL.createObjectURL(
          new Blob([copyBinaryPayload(payload)], { type: "image/png" }),
        );
        originalUrlRef.current = objectUrl;
        setOriginalUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [id, previewOpen]);

  useEffect(
    () => () => {
      if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current);
      originalUrlRef.current = "";
    },
    [],
  );

  return (
    <div ref={hostRef} className={styles.historyImageHost}>
      {failed ? (
        <div className={styles.historyImageFallback}>图片不可用</div>
      ) : !thumbnailUrl ? (
        nearViewport ? <Spin size="small" /> : null
      ) : (
        <Image
          src={thumbnailUrl}
          alt="历史截图"
          className={styles.historyImage}
          onError={() => {
            if (thumbnailUrlRef.current) URL.revokeObjectURL(thumbnailUrlRef.current);
            thumbnailUrlRef.current = "";
            setThumbnailUrl("");
            setFailed(true);
          }}
          preview={{
            src: originalUrl || thumbnailUrl,
            onOpenChange: setPreviewOpen,
          }}
        />
      )}
    </div>
  );
}

export default function ScreenshotHistory() {
  const { notification } = AntApp.useApp();
  const [entries, setEntries] = useState<ScreenshotHistorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<{ id: string; action: HistoryAction } | null>(null);
  const workingRef = useRef(false);
  const refreshGenerationRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const generation = ++refreshGenerationRef.current;
    setLoading(true);
    try {
      const nextEntries = await invoke<ScreenshotHistorySummary[]>("list_screenshot_history");
      if (generation === refreshGenerationRef.current) setEntries(nextEntries);
    } catch (error) {
      if (generation === refreshGenerationRef.current) {
        notification.error({ message: "读取截图历史失败", description: String(error) });
      }
    } finally {
      if (generation === refreshGenerationRef.current) setLoading(false);
    }
  }, [notification]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refresh();
    }, 150);
  }, [refresh]);

  useEffect(() => {
    void refresh();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen("screenshot-history-changed", scheduleRefresh).then((off) => {
      if (disposed) off();
      else unlisten = off;
    });
    return () => {
      disposed = true;
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      unlisten?.();
    };
  }, [refresh, scheduleRefresh]);

  const run = async (
    id: string,
    action: HistoryAction,
    task: () => Promise<unknown>,
    success?: string,
  ) => {
    if (workingRef.current) return;
    workingRef.current = true;
    setWorking({ id, action });
    try {
      await task();
      if (success) notification.success({ message: success });
    } catch (error) {
      notification.error({ message: "截图历史操作失败", description: String(error) });
    } finally {
      workingRef.current = false;
      setWorking(null);
    }
  };

  return (
    <div className={styles.historyPanel}>
      <div className={styles.historyHeader}>
        <div>
          <Text strong>本地截图历史</Text>
          <span className={styles.description}>
            未收藏记录最多保留 100 条且不超过 30 天；连续点击贴图可创建多个独立窗口。
          </span>
        </div>
        <div className={styles.actionRow}>
          <Button
            icon={<ReloadOutlined />}
            loading={loading}
            disabled={working !== null}
            onClick={() => void refresh()}
          >
            刷新
          </Button>
        </div>
      </div>

      {loading && entries.length === 0 ? (
        <div className={styles.historyEmpty}>
          <Spin />
        </div>
      ) : entries.length === 0 ? (
        <Empty description="完成复制、保存或贴图后，截图会出现在这里" />
      ) : (
        <div className={styles.historyGrid}>
          {entries.map((entry) => (
            <article className={styles.historyCard} key={entry.id}>
              <div className={styles.historyPreview}>
                <HistoryImage id={entry.id} />
              </div>
              <div className={styles.historyMeta}>
                <Text ellipsis title={new Date(entry.createdAtMs).toLocaleString("zh-CN")}>
                  {new Date(entry.createdAtMs).toLocaleString("zh-CN")}
                </Text>
                <span className={styles.description}>
                  {entry.width} × {entry.height} · {formatBytes(entry.totalBytes)}
                </span>
              </div>
              <div className={styles.historyActions}>
                <Tooltip title="复制">
                  <Button
                    type="text"
                    icon={<CopyOutlined />}
                    aria-label="复制截图历史"
                    loading={working?.id === entry.id && working.action === "copy"}
                    disabled={
                      loading ||
                      (working !== null &&
                        (working.id !== entry.id || working.action !== "copy"))
                    }
                    onClick={() =>
                      void run(
                        entry.id,
                        "copy",
                        () => invoke("copy_screenshot_history", { id: entry.id }),
                        "截图已复制",
                      )
                    }
                  />
                </Tooltip>
                <Tooltip title="贴图">
                  <Button
                    type="text"
                    icon={<PushpinOutlined />}
                    aria-label="贴出截图历史"
                    loading={working?.id === entry.id && working.action === "pin"}
                    disabled={
                      loading ||
                      (working !== null &&
                        (working.id !== entry.id || working.action !== "pin"))
                    }
                    onClick={() =>
                      void run(
                        entry.id,
                        "pin",
                        () => invoke("pin_screenshot_history", { id: entry.id }),
                        "贴图已创建，可继续贴其他截图",
                      )
                    }
                  />
                </Tooltip>
                <Tooltip title={entry.favorite ? "取消收藏" : "收藏"}>
                  <Button
                    type="text"
                    icon={entry.favorite ? <StarFilled /> : <StarOutlined />}
                    className={entry.favorite ? styles.favoriteButton : undefined}
                    aria-label={entry.favorite ? "取消收藏截图历史" : "收藏截图历史"}
                    loading={working?.id === entry.id && working.action === "favorite"}
                    disabled={
                      loading ||
                      (working !== null &&
                        (working.id !== entry.id || working.action !== "favorite"))
                    }
                    onClick={() =>
                      void run(
                        entry.id,
                        "favorite",
                        async () => {
                          const updated = await invoke<ScreenshotHistorySummary>(
                            "set_screenshot_history_favorite",
                            { id: entry.id, favorite: !entry.favorite },
                          );
                          setEntries((current) =>
                            current.map((item) => (item.id === updated.id ? updated : item)),
                          );
                        },
                        entry.favorite ? "已取消收藏" : "已收藏",
                      )
                    }
                  />
                </Tooltip>
                <Popconfirm
                  title="删除这条截图历史？"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={() =>
                    void run(
                      entry.id,
                      "delete",
                      async () => {
                        await invoke("delete_screenshot_history", { id: entry.id });
                        setEntries((current) => current.filter((item) => item.id !== entry.id));
                      },
                      "截图历史已删除",
                    )
                  }
                >
                  <Tooltip title="删除">
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label="删除截图历史"
                      loading={working?.id === entry.id && working.action === "delete"}
                      disabled={
                        loading ||
                        (working !== null &&
                          (working.id !== entry.id || working.action !== "delete"))
                      }
                    />
                  </Tooltip>
                </Popconfirm>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
