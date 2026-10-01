import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  CopyOutlined,
  CameraOutlined,
  DeleteOutlined,
  PushpinOutlined,
  ReloadOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons";
import {
  App as AntApp,
  Alert,
  Button,
  Empty,
  Grid,
  Image,
  InputNumber,
  Masonry,
  Popconfirm,
  Select,
  Spin,
  Tooltip,
  Typography,
} from "antd";
import type { ScreenshotHistorySummary } from "../screenshots/screenshot/api";
import { errorMessage, historyApi, MAIN_EVENTS, screenshotSettingsApi } from "../api/commands";
import {
  loadScreenshotHistoryView,
  saveScreenshotHistoryView,
  selectScreenshotHistory,
  responsiveHistoryColumnCount,
  screenshotHistoryPhase,
  type HistoryFilter,
  type HistorySort,
} from "./screenshotHistoryView";
import styles from "./components.module.scss";
import { createRequestQueue } from "../utils/requestQueue";

const thumbnailRequests = createRequestQueue(4);

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
        <button
          type="button"
          className={styles.historyPreviewButton}
          aria-label="查看截图原图"
          disabled={opening}
          aria-busy={opening}
          onClick={() => {
            setOpening(true);
            void historyApi
              .openPreview(id)
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
        </button>
      )}
    </div>
  );
}

export default function ScreenshotHistory() {
  const screens = Grid.useBreakpoint();
  const { notification } = AntApp.useApp();
  const [entries, setEntries] = useState<ScreenshotHistorySummary[]>([]);
  const [view, setView] = useState(loadScreenshotHistoryView);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [startingCapture, setStartingCapture] = useState(false);
  const [working, setWorking] = useState<{ id: string; action: HistoryAction } | null>(null);
  const workingRef = useRef(false);
  const refreshGenerationRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);
  const visibleEntries = useMemo(() => selectScreenshotHistory(entries, view), [entries, view]);
  const masonryItems = useMemo(
    () => visibleEntries.map((entry) => ({ key: entry.id, data: entry })),
    [visibleEntries],
  );

  const onColumnCountChange = (columns: number | null) => {
    if (columns === null || !Number.isInteger(columns) || columns < 1 || columns > 10) return;
    setView((current) => ({ ...current, columns }));
  };
  const sharedProps = {
    mode: "spinner" as const,
    min: 1,
    max: 10,
    defaultValue: 3,
    onChange: onColumnCountChange,
    style: { width: 150 },
  };
  const visibleColumnCount = responsiveHistoryColumnCount(view.columns, screens);
  const phase = screenshotHistoryPhase(loading, readError, entries.length, visibleEntries.length);

  useEffect(() => saveScreenshotHistoryView(view), [view]);

  useEffect(() => {
    const error = window.sessionStorage.getItem("dockmapper.history-write-error");
    if (!error) return;
    window.sessionStorage.removeItem("dockmapper.history-write-error");
    setWriteError(error);
  }, []);

  const refresh = useCallback(async () => {
    const generation = ++refreshGenerationRef.current;
    setLoading(true);
    setReadError(null);
    try {
      const nextEntries = await historyApi.list();
      if (generation === refreshGenerationRef.current) setEntries(nextEntries);
    } catch (error) {
      if (generation === refreshGenerationRef.current) {
        setReadError(errorMessage(error));
      }
    } finally {
      if (generation === refreshGenerationRef.current) setLoading(false);
    }
  }, []);

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
    void listen(MAIN_EVENTS.historyChanged, scheduleRefresh)
      .then((off) => {
        if (disposed) off();
        else unlisten = off;
      })
      .catch((error) => {
        if (!disposed) setReadError(`历史更新监听失败：${errorMessage(error)}`);
      });
    return () => {
      disposed = true;
      refreshGenerationRef.current += 1;
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
      notification.error({ message: "截图历史操作失败", description: errorMessage(error) });
    } finally {
      workingRef.current = false;
      setWorking(null);
    }
  };

  const startCapture = async () => {
    setStartingCapture(true);
    try {
      await screenshotSettingsApi.start();
    } catch (error) {
      notification.error({ message: "启动截图失败", description: errorMessage(error) });
    } finally {
      setStartingCapture(false);
    }
  };

  return (
    <div className={styles.historyPanel}>
      <div className={styles.historyHeader}>
        <div className={styles.historyTitleRow}>
          <div className={styles.historyHeading}>
            <Text strong>本地截图历史</Text>
            <span className={styles.description}>
              未收藏记录最多保留 100 条且不超过 30 天；连续点击贴图可创建多个独立窗口。
            </span>
          </div>
          <Button
            type="primary"
            icon={<CameraOutlined />}
            loading={startingCapture}
            onClick={() => void startCapture()}
          >
            开始截图
          </Button>
        </div>
        <div className={styles.historyToolbar}>
          <label className={styles.historyControl}>
            <span>排序</span>
            <Select<HistorySort>
              value={view.sort}
              onChange={(sort) => setView((current) => ({ ...current, sort }))}
              options={[
                { value: "newest", label: "最新优先" },
                { value: "oldest", label: "最早优先" },
                { value: "favorite", label: "收藏优先" },
              ]}
            />
          </label>
          <label className={styles.historyControl}>
            <span>筛选</span>
            <Select<HistoryFilter>
              value={view.filter}
              onChange={(filter) => setView((current) => ({ ...current, filter }))}
              options={[
                { value: "all", label: "全部" },
                { value: "favorite", label: "仅收藏" },
              ]}
            />
          </label>
          <label className={styles.historyControl}>
            <span>列数</span>
            <InputNumber
              {...sharedProps}
              aria-label="截图展示列数"
              value={view.columns}
              precision={0}
            />
          </label>
          <Text type="secondary" className={styles.historyCount}>
            {visibleEntries.length} 条
          </Text>
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

      {readError && (
        <Alert
          type="error"
          showIcon
          message="截图历史读取失败"
          description={readError}
          action={
            <Button loading={loading} onClick={() => void refresh()}>
              重试
            </Button>
          }
        />
      )}

      {writeError && (
        <Alert
          type="warning"
          showIcon
          closable
          message="有一张截图未保存到历史"
          description={writeError}
          onClose={() => setWriteError(null)}
        />
      )}

      {phase === "loading" ? (
        <div className={styles.historyEmpty}>
          <Spin />
        </div>
      ) : phase === "error" ? null : phase === "empty" ? (
        <Empty description="完成复制、保存或贴图后，截图会出现在这里" />
      ) : phase === "filtered" ? (
        <Empty description="没有符合当前筛选条件的截图" />
      ) : (
        <Masonry<ScreenshotHistorySummary>
          className={styles.historyMasonry}
          columns={visibleColumnCount}
          gutter={[12, 12]}
          items={masonryItems}
          itemRender={({ data: entry }) => (
            <article className={styles.historyCard} tabIndex={0}>
              <div
                className={styles.historyPreview}
                style={{ aspectRatio: `${entry.width} / ${entry.height}` }}
              >
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
                    size="small"
                    icon={<CopyOutlined />}
                    aria-label="复制截图历史"
                    loading={working?.id === entry.id && working.action === "copy"}
                    disabled={
                      loading ||
                      (working !== null && (working.id !== entry.id || working.action !== "copy"))
                    }
                    onClick={() =>
                      void run(entry.id, "copy", () => historyApi.copy(entry.id), "截图已复制")
                    }
                  />
                </Tooltip>
                <Tooltip title="贴图">
                  <Button
                    type="text"
                    size="small"
                    icon={<PushpinOutlined />}
                    aria-label="贴出截图历史"
                    loading={working?.id === entry.id && working.action === "pin"}
                    disabled={
                      loading ||
                      (working !== null && (working.id !== entry.id || working.action !== "pin"))
                    }
                    onClick={() =>
                      void run(
                        entry.id,
                        "pin",
                        () => historyApi.pin(entry.id),
                        "贴图已创建，可继续贴其他截图",
                      )
                    }
                  />
                </Tooltip>
                <Tooltip title={entry.favorite ? "取消收藏" : "收藏"}>
                  <Button
                    type="text"
                    size="small"
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
                          const updated = await historyApi.favorite(entry.id, !entry.favorite);
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
                        await historyApi.delete(entry.id);
                        setEntries((current) => current.filter((item) => item.id !== entry.id));
                      },
                      "截图历史已删除",
                    )
                  }
                >
                  <Tooltip title="删除">
                    <Button
                      type="text"
                      size="small"
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
          )}
        />
      )}
    </div>
  );
}
